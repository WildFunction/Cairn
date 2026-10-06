import Foundation
import Testing
@testable import CairnKit

@Suite struct ShelfFootTests {
    let fixture: CloudFixture
    let scratch: Scratch

    init() throws {
        fixture = try CloudFixture.syntheticBook()
        scratch = try Scratch()
    }

    private func foot(place: Place? = nil, finished: Bool = false) throws -> ShelfFoot {
        try scratch.library.updateState(of: Scratch.bookId) { $0.with(place: .some(place), finished: finished) }
        return try #require(scratch.library.book(Scratch.bookId)).foot
    }

    @Test func aBookNobodyOpenedHasNotStarted() throws {
        try scratch.writeAll(fixture: fixture)
        #expect(try foot() == .notStarted)
        #expect(try foot(place: Place(nodeId: "n0", ms: 0, updatedAt: 1, device: "d")) == .notStarted)
    }

    @Test func aPlaceShowsTheChapterTheTimeAndHowFarThroughTheBook() throws {
        try scratch.writeAll(fixture: fixture)
        #expect(try foot(place: Place(nodeId: "n0", ms: 3000, updatedAt: 1, device: "d"))
            == .progress(chapter: 1, ms: 3000, fraction: 0.25))
        #expect(try foot(place: Place(nodeId: "recap", ms: 0, updatedAt: 1, device: "d"))
            == .progress(chapter: 2, ms: 0, fraction: 0.75))
    }

    @Test func aPlaceInAStationThePathNoLongerHasIsNotStarted() throws {
        try scratch.writeAll(fixture: fixture)
        #expect(try foot(place: Place(nodeId: "gone", ms: 3000, updatedAt: 1, device: "d")) == .notStarted)
    }

    @Test func finishedOutranksThePlace() throws {
        try scratch.writeAll(fixture: fixture)
        #expect(try foot(place: Place(nodeId: "recap", ms: 3000, updatedAt: 1, device: "d"), finished: true) == .finished)
    }

    @Test func aBookStillArrivingCountsItsStations() throws {
        try scratch.writeStation("n0", fixture: fixture)
        try scratch.writeBook(fixture: fixture)
        #expect(try foot(place: Place(nodeId: "n0", ms: 3000, updatedAt: 1, device: "d"))
            == .downloading(have: 1, total: 2))
    }
}
