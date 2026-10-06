import Foundation

/// `mergePlaces` in `packages/core/src/sync/progress.ts`, tested against the same table.
public enum ProgressMerge {
    public enum Winner: String, Sendable { case local, remote }

    public static func winner(local: Place?, remote: Place?, nodeIds: [String]) -> Winner {
        guard let local else { return .remote }
        guard let remote else { return .local }
        if local.updatedAt != remote.updatedAt { return remote.updatedAt > local.updatedAt ? .remote : .local }
        let along = { (place: Place) in nodeIds.firstIndex(of: place.nodeId) ?? -1 }
        if along(local) != along(remote) { return along(remote) > along(local) ? .remote : .local }
        return remote.ms > local.ms ? .remote : .local
    }
}
