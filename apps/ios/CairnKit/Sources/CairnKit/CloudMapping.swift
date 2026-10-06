import Foundation
import os

/// A record as CloudKit delivered it, before anything here trusts it.
public struct IncomingRecord: Sendable {
    public let type: String
    public let name: String
    public let zone: String
    public let strings: [String: String]
    public let ints: [String: Int]
    /// Local files CloudKit downloaded for the record's assets.
    public let assets: [String: URL]

    public init(type: String, name: String, zone: String, strings: [String: String], ints: [String: Int], assets: [String: URL]) {
        self.type = type
        self.name = name
        self.zone = zone
        self.strings = strings
        self.ints = ints
        self.assets = assets
    }
}

/// Records in the shapes `packages/core/src/sync/book.ts` writes, as library changes. Anything
/// else — a zone that is not a book, a record missing a field — is nothing, not a guess.
public enum CloudMapping {
    public static func change(for record: IncomingRecord) -> CloudChange? {
        guard let bookId = CloudNames.bookId(ofZone: record.zone) else { return nil }
        switch record.type {
        case CloudNames.stationType:
            guard BookLibrary.isRecordName(record.name), let deck = record.strings["deck"],
                  let audio = record.assets["audio"], let fingerprint = record.strings["fingerprint"]
            else { return nil }
            return .station(bookId: bookId, nodeId: record.name, deck: deck, audio: audio, fingerprint: fingerprint)
        case CloudNames.bookType:
            guard record.name == CloudNames.bookRecord, let manifest = record.strings["manifest"],
                  let fingerprint = record.strings["fingerprint"]
            else { return nil }
            return .book(bookId: bookId, manifest: manifest, cover: record.assets["cover"], fingerprint: fingerprint)
        case CloudNames.progressType:
            guard let place = place(from: record) else { return nil }
            return .progress(bookId: bookId, place: place)
        default:
            return nil
        }
    }

    public static func place(from record: IncomingRecord) -> Place? {
        guard let nodeId = record.strings["nodeId"], !nodeId.isEmpty, let ms = record.ints["ms"],
              let updatedAt = record.ints["updatedAt"]
        else { return nil }
        return Place(nodeId: nodeId, ms: ms, updatedAt: updatedAt, device: record.strings["device"] ?? "")
    }

    public static func removal(name: String, zone: String) -> CloudChange? {
        guard let bookId = CloudNames.bookId(ofZone: zone) else { return nil }
        return .recordRemoved(bookId: bookId, name: name)
    }

    public static func zoneRemoval(zone: String) -> CloudChange? {
        CloudNames.bookId(ofZone: zone).map { .zoneRemoved(bookId: $0) }
    }
}

/// Applies what iCloud says to the books on disk. A record whose fingerprint is already on disk is skipped.
public final class LibrarySync: CloudReceiver, @unchecked Sendable {
    private let library: BookLibrary
    private let onChange: @Sendable (String) -> Void

    public init(library: BookLibrary, onChange: @escaping @Sendable (String) -> Void) {
        self.library = library
        self.onChange = onChange
    }

    public func apply(_ change: CloudChange) async {
        do {
            if let bookId = try write(change) { onChange(bookId) }
        } catch {
            // The next fetch delivers the record again; the book stays as it was.
            Self.log.error("could not apply a change from iCloud: \(String(describing: error), privacy: .public)")
        }
    }

    /// The book that changed, or nothing when the change was already on disk.
    private func write(_ change: CloudChange) throws -> String? {
        switch change {
        case let .station(bookId, nodeId, deck, audio, fingerprint):
            guard library.state(of: bookId).stations[nodeId] != fingerprint || !hasStation(bookId, nodeId) else { return nil }
            try library.writeStation(bookId: bookId, nodeId: nodeId, deck: deck, audio: audio, fingerprint: fingerprint)
            return bookId
        case let .book(bookId, manifest, cover, fingerprint):
            guard library.state(of: bookId).book != fingerprint || !library.isSynced(bookId) else { return nil }
            try library.writeBook(bookId: bookId, manifest: manifest, cover: cover, fingerprint: fingerprint)
            return bookId
        case let .progress(bookId, remote):
            let nodeIds = library.book(bookId)?.manifest?.path.nodes.map(\.id) ?? []
            var changed = false
            try library.updateState(of: bookId) { state in
                guard ProgressMerge.winner(local: state.place, remote: remote, nodeIds: nodeIds) == .remote,
                      state.place != remote
                else { return state }
                changed = true
                return state.with(place: .some(remote), finished: false)
            }
            return changed ? bookId : nil
        case let .recordRemoved(bookId, name):
            if name == CloudNames.progressRecord { return nil }
            if name == CloudNames.bookRecord {
                try library.removeBook(bookId)
            } else {
                guard BookLibrary.isRecordName(name) else { return nil }
                try library.removeStation(bookId: bookId, nodeId: name)
            }
            return bookId
        case let .zoneRemoved(bookId):
            try library.removeBook(bookId)
            return bookId
        }
    }

    private func hasStation(_ bookId: String, _ nodeId: String) -> Bool {
        library.book(bookId).map { book in
            !book.isBuiltIn && book.stations.contains { $0.nodeId == nodeId && $0.isOnDisk }
        } ?? false
    }

    private static let log = Logger(subsystem: "dev.jasper.cairn", category: "sync")
}
