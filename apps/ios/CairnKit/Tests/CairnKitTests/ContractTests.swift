import Foundation
import Testing
@testable import CairnKit

/// `packages/core/tests/sync/contract.test.ts` asserts the Mac still writes this file's contents.
@Suite struct ContractTests {
    @Test func theManifestDecodesIntoEverythingThePlayerShows() throws {
        let fixture = try CloudFixture.syntheticBook()
        let book = try JSONDecoder().decode(SyncedBook.self, from: Data(fixture.string("book", "manifest").utf8))

        #expect(book.format == 1)
        #expect(book.id == "two-stations-a1b2c3")
        #expect(book.title == "Two Stations")
        #expect(book.author == "A. Writer")
        #expect(book.language == "en")
        #expect(book.intro == "A book that exists to be decoded.")
        #expect(book.minutes == 3)
        #expect(book.path.nodes.map(\.id) == ["n0", "recap"])
        #expect(book.path.nodes[0].brief == "What the first station makes clear.")
        #expect(book.path.nodes[0].estMinutes == 2)
        #expect(book.path.nodes[1].isRecap)
        #expect(book.path.stages.map(\.title) == ["Building", "Closing"])
        #expect(book.path.stages[0].nodeIds == ["n0"])
    }

    @Test func aStationsDeckGivesItsLength() throws {
        let fixture = try CloudFixture.syntheticBook()
        let deck = try JSONDecoder().decode(DeckSummary.self, from: Data(fixture.string("n0", "deck").utf8))
        #expect(deck == DeckSummary(nodeId: "n0", durationMs: 9000))
    }

    @Test func recordsArriveAsStationsThenTheBook() throws {
        let fixture = try CloudFixture.syntheticBook()
        #expect(fixture.records.map(\.type) == ["Station", "Station", "Book"])
        #expect(fixture.records.last?.name == "book")
        #expect(fixture.records.first?.fields["audio"]?.asset != nil)
    }
}
