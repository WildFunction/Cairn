// The one process allowed to talk to iCloud: it carries the entitlement the JS main process cannot.
// One JSON request on stdin, one JSON reply on stdout, then exit. The other end is
// packages/core/src/sync/wire.ts and the two must agree.
import CloudKit
import Foundation

let container = CKContainer(identifier: "iCloud.dev.jasper.cairn")
let database = container.privateCloudDatabase

enum Value: Decodable {
    case string(String)
    case int(Int)
    case asset(String)

    private enum Key: String, CodingKey { case string, int, asset }

    init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: Key.self)
        if let text = try box.decodeIfPresent(String.self, forKey: .string) { self = .string(text); return }
        if let number = try box.decodeIfPresent(Int.self, forKey: .int) { self = .int(number); return }
        self = .asset(try box.decode(String.self, forKey: .asset))
    }
}

struct RecordInput: Decodable {
    let type: String
    let name: String
    let fields: [String: Value]
}

struct Request: Decodable {
    let op: String
    let zone: String?
    let records: [RecordInput]?
    let names: [String]?
    let name: String?
    let createZone: Bool?
}

struct Failure: Error {
    let code: String
    let message: String
}

func finish(_ reply: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data("{\"ok\":false}".utf8)
    FileHandle.standardOutput.write(data)
    exit(0)
}

/// The codes `CloudError` knows. `network` is the only one worth retrying.
func failure(from error: Error) -> Failure {
    if let named = error as? Failure { return named }
    guard let cloud = error as? CKError else {
        return Failure(code: "failed", message: String(describing: error))
    }
    if cloud.code == .partialFailure, let first = cloud.partialErrorsByItemID?.values.first {
        return failure(from: first)
    }
    let status = (cloud as NSError).userInfo["CKHTTPStatus"].map { " http \($0)" } ?? ""
    let message = "\(cloud.localizedDescription) (CKError \(cloud.code.rawValue)\(status))"
    switch cloud.code {
    case .notAuthenticated:
        return Failure(code: "no_account", message: message)
    case .zoneNotFound, .userDeletedZone:
        return Failure(code: "zone_missing", message: message)
    case .quotaExceeded:
        return Failure(code: "quota_exceeded", message: message)
    case .networkUnavailable, .networkFailure, .serviceUnavailable, .requestRateLimited, .zoneBusy,
         .serverResponseLost:
        return Failure(code: "network", message: message)
    case .serverRejectedRequest, .badContainer, .missingEntitlement, .permissionFailure, .invalidArguments,
         .badDatabase:
        return Failure(code: "rejected", message: message)
    default:
        return Failure(code: "failed", message: message)
    }
}

func zoneID(_ request: Request) throws -> CKRecordZone.ID {
    guard let name = request.zone, !name.isEmpty else {
        throw Failure(code: "failed", message: "request has no zone")
    }
    return CKRecordZone.ID(zoneName: name, ownerName: CKCurrentUserDefaultName)
}

func isMissingZone(_ error: Error) -> Bool {
    guard let cloud = error as? CKError else { return false }
    return cloud.code == .zoneNotFound || cloud.code == .userDeletedZone
}

func account() async throws -> [String: Any] {
    switch try await container.accountStatus() {
    case .available: return ["ok": true, "account": "available"]
    case .noAccount: return ["ok": true, "account": "no_account"]
    case .restricted: return ["ok": true, "account": "restricted"]
    default: return ["ok": true, "account": "unknown"]
    }
}

func fingerprints(_ request: Request) async throws -> [String: Any] {
    let zone = try zoneID(request)
    var found: [String: String] = [:]
    var token: CKServerChangeToken?
    do {
        while true {
            let page = try await database.recordZoneChanges(
                inZoneWith: zone, since: token, desiredKeys: ["fingerprint"])
            for (id, result) in page.modificationResultsByID {
                found[id.recordName] = (try result.get().record["fingerprint"] as? String) ?? ""
            }
            for deletion in page.deletions { found[deletion.recordID.recordName] = nil }
            token = page.changeToken
            if !page.moreComing { break }
        }
    } catch where isMissingZone(error) {
        return ["ok": true, "fingerprints": [String: String]()]
    }
    return ["ok": true, "fingerprints": found]
}

/// One record's string and integer fields; assets are not fetched. Null when it or its zone is missing.
func fetch(_ request: Request) async throws -> [String: Any] {
    let zone = try zoneID(request)
    guard let name = request.name, !name.isEmpty else {
        throw Failure(code: "failed", message: "request has no record name")
    }
    let record: CKRecord
    do {
        record = try await database.record(for: CKRecord.ID(recordName: name, zoneID: zone))
    } catch where isMissingZone(error) || (error as? CKError)?.code == .unknownItem {
        return ["ok": true, "record": NSNull()]
    }
    var fields: [String: Any] = [:]
    for key in record.allKeys() {
        switch record[key] {
        case let text as String: fields[key] = ["string": text]
        case let number as Int: fields[key] = ["int": number]
        case let number as Int64: fields[key] = ["int": number]
        default: break
        }
    }
    return ["ok": true, "record": ["type": record.recordType, "fields": fields]]
}

func save(_ request: Request) async throws -> [String: Any] {
    let zone = try zoneID(request)
    // A reader's place must not bring back a zone its book was removed from.
    if request.createZone ?? true {
        let created = try await database.modifyRecordZones(saving: [CKRecordZone(zoneID: zone)], deleting: [])
        for (_, result) in created.saveResults { _ = try result.get() }
    }

    let records = (request.records ?? []).map { input -> CKRecord in
        let record = CKRecord(
            recordType: input.type, recordID: CKRecord.ID(recordName: input.name, zoneID: zone))
        for (key, value) in input.fields {
            switch value {
            case .string(let text): record[key] = text
            case .int(let number): record[key] = number
            case .asset(let path): record[key] = CKAsset(fileURL: URL(fileURLWithPath: path))
            }
        }
        return record
    }
    // .allKeys: the Mac is the only writer of these records, so the server's copy never wins.
    let saved = try await database.modifyRecords(saving: records, deleting: [], savePolicy: .allKeys)
    for (_, result) in saved.saveResults { _ = try result.get() }
    return ["ok": true]
}

func remove(_ request: Request) async throws -> [String: Any] {
    let zone = try zoneID(request)
    let ids = (request.names ?? []).map { CKRecord.ID(recordName: $0, zoneID: zone) }
    do {
        let removed = try await database.modifyRecords(saving: [], deleting: ids)
        for (_, result) in removed.deleteResults {
            if case .failure(let error) = result, (error as? CKError)?.code != .unknownItem { throw error }
        }
    } catch where isMissingZone(error) {
        return ["ok": true]
    }
    return ["ok": true]
}

func dropZone(_ request: Request) async throws -> [String: Any] {
    let zone = try zoneID(request)
    do {
        try await database.deleteRecordZone(withID: zone)
    } catch where isMissingZone(error) {
        return ["ok": true]
    }
    return ["ok": true]
}

do {
    let request = try JSONDecoder().decode(Request.self, from: FileHandle.standardInput.readDataToEndOfFile())
    switch request.op {
    case "account": finish(try await account())
    case "fingerprints": finish(try await fingerprints(request))
    case "fetch": finish(try await fetch(request))
    case "save": finish(try await save(request))
    case "remove": finish(try await remove(request))
    case "dropZone": finish(try await dropZone(request))
    default: throw Failure(code: "failed", message: "unknown op \(request.op)")
    }
} catch {
    let named = failure(from: error)
    finish(["ok": false, "error": ["code": named.code, "message": named.message]])
}
