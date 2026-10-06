import Foundation

/// The Book record's `manifest`, as `packages/core/src/sync/book.ts` writes it.
public struct SyncedBook: Codable, Equatable, Sendable {
    /// The highest `format` this build reads. A book above it is listed as needing an update.
    public static let supportedFormat = 1

    public let format: Int
    public let id: String
    public let title: String
    public let author: String?
    public let language: String?
    public let kind: String?
    public let intro: String?
    public let minutes: Double
    public let path: BookPath
}

public struct BookPath: Codable, Equatable, Sendable {
    public let bookId: String
    public let title: String
    public let type: String
    public let nodes: [PathNode]
    public let stages: [PathStage]
    public let totalMinutes: Double
    public let generatedAt: String
}

public struct PathNode: Codable, Equatable, Sendable, Identifiable {
    public static let recapKind = "recap"

    public let id: String
    public let idx: Int
    public let title: String
    /// Left a string: a kind added on the Mac must not make an older phone refuse the book.
    public let kind: String
    public let brief: String
    public let keyPoints: [String]
    public let sourceChapters: [Int]
    public let estMinutes: Double

    public var isRecap: Bool { kind == Self.recapKind }
}

public struct PathStage: Codable, Equatable, Sendable {
    public let title: String
    public let nodeIds: [String]
}

/// The two fields of a deck the app reads. The rest is the slide page's business.
public struct DeckSummary: Decodable, Equatable, Sendable {
    public let nodeId: String
    public let durationMs: Int
}

/// Read before the whole manifest, so a future `format` is recognised rather than failing to decode.
struct ManifestHeader: Decodable {
    let format: Int
    let title: String?
}
