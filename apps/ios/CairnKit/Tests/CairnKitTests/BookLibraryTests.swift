import Foundation
import Testing
@testable import CairnKit

@Suite struct BookLibraryTests {
    let fixture: CloudFixture

    init() throws { fixture = try CloudFixture.syntheticBook() }

    @Test func aWrittenBookReadsBackWithItsStationsAndLengths() throws {
        let scratch = try Scratch()
        try scratch.writeAll(fixture: fixture)

        let book = try #require(scratch.library.books().first)
        #expect(book.id == Scratch.bookId)
        #expect(!book.isBuiltIn)
        #expect(book.manifest?.title == "Two Stations")
        #expect(book.stations == [
            StationFile(nodeId: "n0", durationMs: 9000, isOnDisk: true),
            StationFile(nodeId: "recap", durationMs: 3000, isOnDisk: true),
        ])
        #expect(book.isComplete && book.canOpen)
        #expect(try scratch.library.deckText(of: book, nodeId: "n0") == fixture.string("n0", "deck"))
        #expect(FileManager.default.fileExists(atPath: scratch.library.audioURL(of: book, nodeId: "n0").path))
    }

    @Test func aBookIsNotListedUntilItsBookRecordArrives() throws {
        let scratch = try Scratch()
        try scratch.writeStation("n0", fixture: fixture)
        #expect(scratch.library.books().isEmpty)
        #expect(!scratch.library.isSynced(Scratch.bookId))

        try scratch.writeBook(fixture: fixture)
        let book = try #require(scratch.library.books().first)
        #expect(book.stationsOnDisk == 1)
        #expect(book.canOpen && !book.isComplete)
        #expect(book.durationMs(at: 1) == 60_000, "a station still on the way is as long as the path estimated")
    }

    @Test func aStationWithoutItsAudioIsNotPlayable() throws {
        let scratch = try Scratch()
        try scratch.writeAll(fixture: fixture)
        let book = try #require(scratch.library.book(Scratch.bookId))
        try FileManager.default.removeItem(at: scratch.library.audioURL(of: book, nodeId: "recap"))
        #expect(scratch.library.book(Scratch.bookId)?.stations[1].isOnDisk == false)
    }

    @Test func aFutureFormatIsListedButNotParsed() throws {
        let scratch = try Scratch()
        try scratch.library.writeBook(
            bookId: Scratch.bookId, manifest: #"{"format":2,"title":"From the future","path":"reshaped"}"#,
            cover: nil, fingerprint: "f")
        let book = try #require(scratch.library.books().first)
        #expect(book.content == .needsUpdate(title: "From the future"))
        #expect(!book.canOpen)
        #expect(book.foot == .needsUpdate)
    }

    @Test func theCoverIsReplacedAndRemovedWithTheBookRecord() throws {
        let scratch = try Scratch()
        let png = scratch.root.appending(path: "art.PNG")
        try Data("png".utf8).write(to: png)
        try scratch.library.writeBook(
            bookId: Scratch.bookId, manifest: fixture.string("book", "manifest"), cover: png, fingerprint: "a")
        #expect(scratch.library.book(Scratch.bookId)?.cover?.lastPathComponent == "cover.png")

        try scratch.writeBook(fixture: fixture)
        #expect(scratch.library.book(Scratch.bookId)?.cover == nil)
    }

    @Test func stateSurvivesAndToleratesAnOlderFile() throws {
        let scratch = try Scratch()
        try scratch.writeAll(fixture: fixture)
        let place = Place(nodeId: "n0", ms: 4200, updatedAt: 99, device: "phone")
        try scratch.library.updateState(of: Scratch.bookId) { $0.with(place: .some(place)) }

        let state = scratch.library.state(of: Scratch.bookId)
        #expect(state.place == place)
        #expect(state.stations["n0"] == (try fixture.string("n0", "fingerprint")))
        #expect(state.book == (try fixture.string("book", "fingerprint")))

        let old = try JSONDecoder().decode(BookState.self, from: Data(#"{"place":null}"#.utf8))
        #expect(old == .empty)
    }

    @Test func theBuiltInBookIsReadInPlaceAndKeepsItsStateInTheWritableRoot() throws {
        let bundle = try Scratch()
        try bundle.writeAll(fixture: fixture)
        let bundleRoot = bundle.root.appending(path: "Library")
        try FileManager.default.removeItem(at: bundleRoot.appending(path: "books/\(Scratch.bookId)/state.json"))

        let scratch = try Scratch(builtIn: bundleRoot)
        let book = try #require(scratch.library.books().first)
        #expect(book.isBuiltIn && book.isComplete)
        #expect(try scratch.library.deckText(of: book, nodeId: "n0") == fixture.string("n0", "deck"))

        try scratch.library.updateState(of: Scratch.bookId) { $0.with(finished: true) }
        #expect(scratch.library.book(Scratch.bookId)?.state.finished == true)
        #expect(!FileManager.default.fileExists(atPath: bundleRoot.appending(path: "books/\(Scratch.bookId)/state.json").path))
        #expect(!scratch.library.isSynced(Scratch.bookId))
    }

    @Test func aSyncedCopyReplacesTheBuiltInOneOnlyOnceItIsWhole() throws {
        let bundle = try Scratch()
        try bundle.writeAll(fixture: fixture)
        let scratch = try Scratch(builtIn: bundle.root.appending(path: "Library"))

        try scratch.writeStation("n0", fixture: fixture)
        try scratch.writeBook(fixture: fixture)
        #expect(scratch.library.book(Scratch.bookId)?.isBuiltIn == true)

        try scratch.writeStation("recap", fixture: fixture)
        #expect(scratch.library.book(Scratch.bookId)?.isBuiltIn == false)
        #expect(scratch.library.books().count == 1)
    }

    @Test func removingAStationOrABookLeavesNothingBehind() throws {
        let scratch = try Scratch()
        try scratch.writeAll(fixture: fixture)

        try scratch.library.removeStation(bookId: Scratch.bookId, nodeId: "recap")
        let book = try #require(scratch.library.book(Scratch.bookId))
        #expect(book.stations.map(\.isOnDisk) == [true, false])
        #expect(book.state.stations.keys.sorted() == ["n0"])

        try scratch.library.removeBook(Scratch.bookId)
        #expect(scratch.library.books().isEmpty)
        #expect(scratch.library.state(of: Scratch.bookId) == .empty)
    }

    @Test func namesThatWouldLeaveTheLibraryAreRefused() throws {
        let scratch = try Scratch()
        #expect(throws: LibraryError.unsafeName("../escape")) {
            try scratch.library.writeBook(bookId: "../escape", manifest: "{}", cover: nil, fingerprint: "f")
        }
        #expect(throws: LibraryError.unsafeName("../n0")) {
            try scratch.library.writeStation(
                bookId: Scratch.bookId, nodeId: "../n0", deck: "{}", audio: scratch.audio, fingerprint: "f")
        }
        #expect(scratch.library.book("../escape") == nil)
    }

    @Test func bytesUsedCountsWhatSyncWrote() throws {
        let scratch = try Scratch()
        #expect(scratch.library.bytesUsed() == 0)
        try scratch.writeAll(fixture: fixture)
        #expect(scratch.library.bytesUsed() > 32)
    }
}
