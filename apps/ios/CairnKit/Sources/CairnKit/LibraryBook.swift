import Foundation

public struct StationFile: Equatable, Sendable {
    public let nodeId: String
    /// The audio's real length; absent until the deck is on disk.
    public let durationMs: Int?
    /// Playable: the deck and its audio are both here.
    public let isOnDisk: Bool
}

public struct LibraryBook: Equatable, Sendable, Identifiable {
    public enum Content: Equatable, Sendable {
        case readable(SyncedBook)
        /// Written by a newer Cairn than this one; nothing past the title was parsed.
        case needsUpdate(title: String?)
    }

    public let id: String
    public let isBuiltIn: Bool
    public let content: Content
    public let cover: URL?
    /// In walking order. Empty for a book that needs an update.
    public let stations: [StationFile]
    public let state: BookState

    public var manifest: SyncedBook? {
        if case .readable(let manifest) = content { return manifest }
        return nil
    }

    public var stationsOnDisk: Int { stations.filter(\.isOnDisk).count }
    public var isComplete: Bool { manifest != nil && stationsOnDisk == stations.count }

    /// A book opens once its first station can play; the rest arrive behind the reader.
    public var canOpen: Bool { stations.first?.isOnDisk == true }

    /// The station's real length, or the path's estimate while its deck is still on the way.
    public func durationMs(at index: Int) -> Int {
        guard stations.indices.contains(index) else { return 0 }
        if let known = stations[index].durationMs { return known }
        let estimate = manifest?.path.nodes[safe: index]?.estMinutes ?? 0
        return Int(estimate * 60_000)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
