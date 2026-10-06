import Foundation

/// The last line of a shelf card. Downloading outranks progress: a count that is moving is the news.
public enum ShelfFoot: Equatable, Sendable {
    case needsUpdate
    case downloading(have: Int, total: Int)
    case notStarted
    case finished
    case progress(chapter: Int, ms: Int, fraction: Double)
}

extension LibraryBook {
    public var foot: ShelfFoot {
        guard let manifest else { return .needsUpdate }
        if !isComplete { return .downloading(have: stationsOnDisk, total: stations.count) }
        if state.finished { return .finished }
        guard let place = state.place,
              let index = manifest.path.nodes.firstIndex(where: { $0.id == place.nodeId }),
              index > 0 || place.ms > 0
        else { return .notStarted }

        let total = stations.indices.reduce(0) { $0 + durationMs(at: $1) }
        let before = (0..<index).reduce(0) { $0 + durationMs(at: $1) }
        let fraction = total > 0 ? min(1, Double(before + place.ms) / Double(total)) : 0
        return .progress(chapter: index + 1, ms: place.ms, fraction: fraction)
    }
}
