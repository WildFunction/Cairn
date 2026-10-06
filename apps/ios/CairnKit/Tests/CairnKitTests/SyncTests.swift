import Foundation
import Testing
@testable import CairnKit

/// The other end of `packages/core/tests/sync/progress.test.ts`: one table, two languages.
@Suite struct ProgressMergeTests {
    struct Table: Decodable {
        struct Row: Decodable {
            let name: String
            let local: Place?
            let remote: Place?
            let winner: String
        }

        let path: [String]
        let cases: [Row]
    }

    @Test func theMergeRuleMatchesTheSharedTable() throws {
        let table = try JSONDecoder().decode(Table.self, from: Fixtures.data("progress-merge.json"))
        #expect(table.cases.count >= 8)
        for row in table.cases {
            let winner = ProgressMerge.winner(local: row.local, remote: row.remote, nodeIds: table.path)
            #expect(winner.rawValue == row.winner, "\(row.name)")
        }
    }
}

/// iCloud as a list of changes delivered on the next fetch.
final class FakeCloudBooks: CloudBooks, @unchecked Sendable {
    var queued: [IncomingRecord] = []
    var removed: [(name: String, zone: String)] = []
    var droppedZones: [String] = []
    var sent: [(Place, String)] = []
    let receiver: CloudReceiver

    init(receiver: CloudReceiver) { self.receiver = receiver }

    func account() async -> CloudAccount { .available }

    func fetchChanges() async throws {
        for record in queued { if let change = CloudMapping.change(for: record) { await receiver.apply(change) } }
        for (name, zone) in removed { if let change = CloudMapping.removal(name: name, zone: zone) { await receiver.apply(change) } }
        for zone in droppedZones { if let change = CloudMapping.zoneRemoval(zone: zone) { await receiver.apply(change) } }
        queued = []
        removed = []
        droppedZones = []
    }

    func send(progress: Place, bookId: String) async { sent.append((progress, bookId)) }

    var removalFails = false

    func remove(bookId: String) async throws {
        if removalFails { throw CloudFailure.unavailable }
        await receiver.apply(.zoneRemoved(bookId: bookId))
    }
}

@Suite struct LibrarySyncTests {
    let fixture: CloudFixture
    let scratch: Scratch
    let changed = Changed()
    let cloud: FakeCloudBooks
    let zone = CloudNames.zone(of: Scratch.bookId)

    final class Changed: @unchecked Sendable {
        private let lock = NSLock()
        private var ids: [String] = []
        func add(_ id: String) { lock.withLock { ids.append(id) } }
        var all: [String] { lock.withLock { ids } }
    }

    init() throws {
        fixture = try CloudFixture.syntheticBook()
        scratch = try Scratch()
        let changed = self.changed
        cloud = FakeCloudBooks(receiver: LibrarySync(library: scratch.library) { changed.add($0) })
    }

    /// The fixture's records, as CloudKit would hand them over.
    private func records() throws -> [IncomingRecord] {
        try fixture.records.map { record in
            var strings: [String: String] = [:]
            var assets: [String: URL] = [:]
            for (key, value) in record.fields {
                if let text = value.string { strings[key] = text }
                if value.asset != nil {
                    let file = scratch.root.appending(path: "\(record.name)-\(key)-download")
                    try Data("bytes of \(record.name)".utf8).write(to: file)
                    assets[key] = file
                }
            }
            return IncomingRecord(type: record.type, name: record.name, zone: zone, strings: strings, ints: [:], assets: assets)
        }
    }

    @Test func aNewBookArrivesWhole() async throws {
        cloud.queued = try records()
        try await cloud.fetchChanges()
        let book = try #require(scratch.library.books().first)
        #expect(book.isComplete && !book.isBuiltIn)
        #expect(book.manifest?.title == "Two Stations")
        #expect(try scratch.library.deckText(of: book, nodeId: "n0") == fixture.string("n0", "deck"))
        #expect(try String(contentsOf: scratch.library.audioURL(of: book, nodeId: "n0"), encoding: .utf8) == "bytes of n0")
        #expect(changed.all.count == 3)
    }

    @Test func anUnchangedRecordIsSkippedAndAChangedOneReplaced() async throws {
        let all = try records()
        cloud.queued = all
        try await cloud.fetchChanges()
        let before = changed.all.count

        cloud.queued = all
        try await cloud.fetchChanges()
        #expect(changed.all.count == before, "fingerprints match: nothing written")

        let station = try #require(all.first)
        var strings = station.strings
        strings["fingerprint"] = "respoken"
        strings["deck"] = #"{"nodeId":"n0","slides":[],"narration":[],"audioPath":"audio/n0.mp3","durationMs":7000}"#
        cloud.queued = [IncomingRecord(type: station.type, name: station.name, zone: zone, strings: strings, ints: [:], assets: station.assets)]
        try await cloud.fetchChanges()
        #expect(changed.all.count == before + 1)
        #expect(scratch.library.book(Scratch.bookId)?.stations.first?.durationMs == 7000)
        #expect(scratch.library.state(of: Scratch.bookId).stations["n0"] == "respoken")
    }

    @Test func aDeletedZoneRemovesTheBook() async throws {
        cloud.queued = try records()
        try await cloud.fetchChanges()
        cloud.droppedZones = [zone]
        try await cloud.fetchChanges()
        #expect(scratch.library.books().isEmpty)
    }

    @Test func removingABookTakesItOffThisPhoneAndFreesItsSpace() async throws {
        cloud.queued = try records()
        try await cloud.fetchChanges()
        #expect(scratch.library.bytesUsed(by: Scratch.bookId) > 0)
        try await cloud.remove(bookId: Scratch.bookId)
        #expect(scratch.library.books().isEmpty)
        #expect(scratch.library.bytesUsed(by: Scratch.bookId) == 0)
    }

    @Test func aRemovalThatCannotReachICloudChangesNothing() async throws {
        cloud.queued = try records()
        try await cloud.fetchChanges()
        cloud.removalFails = true
        await #expect(throws: CloudFailure.unavailable) { try await cloud.remove(bookId: Scratch.bookId) }
        #expect(scratch.library.books().count == 1)
    }

    @Test func aStationRemovedFromThePathIsRemovedFromDisk() async throws {
        cloud.queued = try records()
        try await cloud.fetchChanges()
        cloud.removed = [("recap", zone)]
        try await cloud.fetchChanges()
        #expect(scratch.library.book(Scratch.bookId)?.stations.map(\.isOnDisk) == [true, false])
    }

    @Test func aFutureFormatIsListedAsNeedingAnUpdate() async throws {
        cloud.queued = [IncomingRecord(
            type: "Book", name: "book", zone: zone, strings: ["manifest": #"{"format":9,"title":"Later"}"#, "fingerprint": "f"],
            ints: [:], assets: [:])]
        try await cloud.fetchChanges()
        #expect(scratch.library.books().first?.content == .needsUpdate(title: "Later"))
    }

    @Test func recordsFromElsewhereAreIgnored() async throws {
        cloud.queued = [
            IncomingRecord(type: "Book", name: "book", zone: "not-a-book", strings: ["manifest": "{}", "fingerprint": "f"], ints: [:], assets: [:]),
            IncomingRecord(type: "Station", name: "../n0", zone: zone, strings: ["deck": "{}", "fingerprint": "f"], ints: [:], assets: ["audio": scratch.audio]),
            IncomingRecord(type: "Probe", name: "x", zone: zone, strings: [:], ints: [:], assets: [:]),
        ]
        try await cloud.fetchChanges()
        #expect(changed.all.isEmpty)
    }

    @Test func aNewerPlaceFromTheMacMovesTheReaderAndAnOlderOneDoesNot() async throws {
        cloud.queued = try records()
        try await cloud.fetchChanges()
        try scratch.library.updateState(of: Scratch.bookId) {
            $0.with(place: .some(Place(nodeId: "n0", ms: 1000, updatedAt: 500, device: "iPhone")), finished: true)
        }
        let progress = { (ms: Int, at: Int) in
            IncomingRecord(type: "Progress", name: "progress", zone: zone, strings: ["nodeId": "recap", "device": "Mac"],
                           ints: ["ms": ms, "updatedAt": at], assets: [:])
        }
        cloud.queued = [progress(2000, 400)]
        try await cloud.fetchChanges()
        #expect(scratch.library.state(of: Scratch.bookId).place?.ms == 1000)

        cloud.queued = [progress(2000, 600)]
        try await cloud.fetchChanges()
        let state = scratch.library.state(of: Scratch.bookId)
        #expect(state.place == Place(nodeId: "recap", ms: 2000, updatedAt: 600, device: "Mac"))
        #expect(!state.finished, "a place from elsewhere means the reader is walking it again")
    }
}
