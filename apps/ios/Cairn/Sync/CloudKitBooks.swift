import CairnKit
import CloudKit
import os

/// The owner's private database through `CKSyncEngine`, which tracks what is new, retries, and
/// listens for pushes. If it cannot be made to deliver assets reliably, the fallback is
/// `CKFetchRecordZoneChangesOperation` behind the same `CloudBooks`.
final class CloudKitBooks: CloudBooks, CKSyncEngineDelegate, @unchecked Sendable {
    static let containerID = "iCloud.dev.jasper.cairn"

    private let container = CKContainer(identifier: CloudKitBooks.containerID)
    private let library: BookLibrary
    private let receiver: CloudReceiver
    private let stateFile: URL
    private let lock = NSLock()
    private var engine: CKSyncEngine?
    /// The last copy of each Progress record seen, so a save carries the server's change tag.
    private var progressRecords: [CKRecord.ID: CKRecord] = [:]
    private let log = Logger(subsystem: "dev.jasper.cairn", category: "cloud")

    init(library: BookLibrary, receiver: CloudReceiver, stateFile: URL) {
        self.library = library
        self.receiver = receiver
        self.stateFile = stateFile
    }

    // MARK: CloudBooks

    func account() async -> CloudAccount {
        do {
            switch try await container.accountStatus() {
            case .available: return .available
            case .noAccount: return .noAccount
            case .restricted: return .restricted
            case .temporarilyUnavailable: return .temporarilyUnavailable
            default: return .unknown
            }
        } catch {
            log.error("account status failed: \(error.localizedDescription, privacy: .public)")
            return .unknown
        }
    }

    func fetchChanges() async throws {
        try await syncEngine().fetchChanges()
    }

    func send(progress: Place, bookId: String) async {
        let id = CKRecord.ID(recordName: CloudNames.progressRecord, zoneID: zoneID(bookId))
        let engine = syncEngine()
        engine.state.add(pendingRecordZoneChanges: [.saveRecord(id)])
        // Left to itself the engine sends when it next finds a good moment, which can be minutes away.
        do {
            try await engine.sendChanges()
        } catch {
            log.error("sending the place in \(bookId, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Straight to the database rather than through the engine's queue: the reader is waiting for a yes or a no.
    func remove(bookId: String) async throws {
        let zone = zoneID(bookId)
        do {
            try await container.privateCloudDatabase.deleteRecordZone(withID: zone)
        } catch let error as CKError where error.code == .zoneNotFound || error.code == .userDeletedZone {
            // Already gone from iCloud; only this phone's copy is left to remove.
        }
        // Its place has nowhere to go now.
        let progress = CKRecord.ID(recordName: CloudNames.progressRecord, zoneID: zone)
        syncEngine().state.remove(pendingRecordZoneChanges: [.saveRecord(progress)])
        lock.withLock { progressRecords[progress] = nil }
        await receiver.apply(.zoneRemoved(bookId: bookId))
    }

    // MARK: CKSyncEngineDelegate

    func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
        switch event {
        case .stateUpdate(let update):
            saveState(update.stateSerialization)
        case .accountChange(let change):
            await accountChanged(change.changeType)
        case .fetchedDatabaseChanges(let changes):
            for deletion in changes.deletions {
                if let change = CloudMapping.zoneRemoval(zone: deletion.zoneID.zoneName) { await receiver.apply(change) }
            }
        case .fetchedRecordZoneChanges(let changes):
            for modification in changes.modifications { await receive(modification.record) }
            for deletion in changes.deletions {
                if let change = CloudMapping.removal(name: deletion.recordID.recordName, zone: deletion.recordID.zoneID.zoneName) {
                    await receiver.apply(change)
                }
            }
        case .sentRecordZoneChanges(let sent):
            for record in sent.savedRecords { remember(record) }
            for failure in sent.failedRecordSaves { await failed(failure, engine: syncEngine) }
        default:
            break
        }
    }

    func nextRecordZoneChangeBatch(
        _ context: CKSyncEngine.SendChangesContext, syncEngine: CKSyncEngine
    ) async -> CKSyncEngine.RecordZoneChangeBatch? {
        let pending = syncEngine.state.pendingRecordZoneChanges.filter { context.options.scope.contains($0) }
        guard !pending.isEmpty else { return nil }
        return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: pending) { [weak self] id in
            self?.progressRecord(for: id)
        }
    }

    // MARK: Records

    private func receive(_ record: CKRecord) async {
        if record.recordType == CloudNames.progressType { remember(record) }
        var strings: [String: String] = [:]
        var ints: [String: Int] = [:]
        var assets: [String: URL] = [:]
        for key in record.allKeys() {
            switch record[key] {
            case let text as String: strings[key] = text
            case let number as Int: ints[key] = number
            case let number as Int64: ints[key] = Int(number)
            case let asset as CKAsset: if let url = asset.fileURL { assets[key] = url }
            default: break
            }
        }
        let incoming = IncomingRecord(
            type: record.recordType, name: record.recordID.recordName, zone: record.recordID.zoneID.zoneName,
            strings: strings, ints: ints, assets: assets)
        guard let change = CloudMapping.change(for: incoming) else {
            log.info("ignored \(record.recordType, privacy: .public) \(record.recordID.recordName, privacy: .public)")
            return
        }
        // The downloaded asset files are only promised until this returns.
        await receiver.apply(change)
    }

    /// The place on disk is the truth; the record is built from it when CloudKit asks.
    private func progressRecord(for id: CKRecord.ID) -> CKRecord? {
        guard let bookId = CloudNames.bookId(ofZone: id.zoneID.zoneName),
              let place = library.state(of: bookId).place
        else { return nil }
        let record = lock.withLock { progressRecords[id] } ?? CKRecord(recordType: CloudNames.progressType, recordID: id)
        record["nodeId"] = place.nodeId
        record["ms"] = place.ms
        record["updatedAt"] = place.updatedAt
        record["device"] = place.device
        return record
    }

    private func remember(_ record: CKRecord) {
        guard record.recordType == CloudNames.progressType else { return }
        lock.withLock { progressRecords[record.recordID] = record }
    }

    private func failed(_ failure: CKSyncEngine.Event.SentRecordZoneChanges.FailedRecordSave, engine: CKSyncEngine) async {
        let id = failure.record.recordID
        switch failure.error.code {
        case .serverRecordChanged:
            // Someone else wrote the place: the merge rule decides, and the winner is saved on the server's copy.
            guard let server = failure.error.serverRecord else { return }
            await receive(server)
            engine.state.add(pendingRecordZoneChanges: [.saveRecord(id)])
            // Detached, not a plain Task: a Task made here inherits "inside a delegate callback", and
            // CloudKit traps when the engine is called back into from one.
            Task.detached { [log] in
                do {
                    try await engine.sendChanges()
                } catch {
                    log.error("resending \(id.recordName, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        case .zoneNotFound, .userDeletedZone:
            // The book left iCloud; its place has nowhere to go.
            engine.state.remove(pendingRecordZoneChanges: [.saveRecord(id)])
        default:
            log.error("saving \(id.recordName, privacy: .public) failed: \(failure.error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: Engine

    private func syncEngine() -> CKSyncEngine {
        lock.withLock {
            if let engine { return engine }
            let configuration = CKSyncEngine.Configuration(
                database: container.privateCloudDatabase, stateSerialization: loadState(), delegate: self)
            let made = CKSyncEngine(configuration)
            engine = made
            return made
        }
    }

    private func zoneID(_ bookId: String) -> CKRecordZone.ID {
        CKRecordZone.ID(zoneName: CloudNames.zone(of: bookId), ownerName: CKCurrentUserDefaultName)
    }

    /// Books belong to the account that synced them; another account's are taken off this phone.
    private func accountChanged(_ type: CKSyncEngine.Event.AccountChange.ChangeType) async {
        switch type {
        case .signOut, .switchAccounts:
            for book in library.books() where library.isSynced(book.id) {
                await receiver.apply(.zoneRemoved(bookId: book.id))
            }
        default:
            break
        }
    }

    private func loadState() -> CKSyncEngine.State.Serialization? {
        guard let data = try? Data(contentsOf: stateFile) else { return nil }
        do {
            return try JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: data)
        } catch {
            log.error("sync state unreadable, starting over: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    private func saveState(_ state: CKSyncEngine.State.Serialization) {
        do {
            try JSONEncoder().encode(state).write(to: stateFile, options: .atomic)
        } catch {
            log.error("could not keep the sync state: \(error.localizedDescription, privacy: .public)")
        }
    }
}
