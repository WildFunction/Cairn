import Foundation
@testable import CairnKit

/// The fixtures both languages read live with the TypeScript tests, not in a copy here.
enum Fixtures {
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "packages/core/tests/sync/fixtures")

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appending(path: name))
    }
}

struct CloudFixture: Decodable {
    struct Value: Decodable {
        let string: String?
        let asset: String?
    }

    struct Record: Decodable {
        let type: String
        let name: String
        let fields: [String: Value]
    }

    let records: [Record]

    static func syntheticBook() throws -> CloudFixture {
        try JSONDecoder().decode(CloudFixture.self, from: Fixtures.data("synthetic-book.json"))
    }

    func string(_ record: String, _ field: String) throws -> String {
        guard let value = records.first(where: { $0.name == record })?.fields[field]?.string else {
            throw FixtureError.missing("\(record).\(field)")
        }
        return value
    }

    var stationNames: [String] { records.filter { $0.type == "Station" }.map(\.name) }
}

enum FixtureError: Error { case missing(String) }

/// A library in a temporary directory, with the synthetic book's records written the way sync writes them.
struct Scratch {
    let root: URL
    let library: BookLibrary
    let audio: URL

    init(builtIn: URL? = nil) throws {
        root = FileManager.default.temporaryDirectory.appending(path: "cairnkit-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        library = BookLibrary(root: root.appending(path: "Library"), builtIn: builtIn)
        audio = root.appending(path: "asset.mp3")
        try Data("not really audio".utf8).write(to: audio)
    }

    static let bookId = "two-stations-a1b2c3"

    func writeStation(_ name: String, fixture: CloudFixture, into target: BookLibrary? = nil) throws {
        try (target ?? library).writeStation(
            bookId: Self.bookId, nodeId: name, deck: fixture.string(name, "deck"), audio: audio,
            fingerprint: fixture.string(name, "fingerprint"))
    }

    func writeBook(fixture: CloudFixture, into target: BookLibrary? = nil) throws {
        try (target ?? library).writeBook(
            bookId: Self.bookId, manifest: fixture.string("book", "manifest"), cover: nil,
            fingerprint: fixture.string("book", "fingerprint"))
    }

    func writeAll(fixture: CloudFixture, into target: BookLibrary? = nil) throws {
        for name in fixture.stationNames { try writeStation(name, fixture: fixture, into: target) }
        try writeBook(fixture: fixture, into: target)
    }
}
