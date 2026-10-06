import CairnKit

/// Stands in when this build cannot reach iCloud at all: the built-in book still plays.
final class NoCloud: CloudBooks {
    func account() async -> CloudAccount { .unknown }
    func fetchChanges() async throws {}
    func send(progress: Place, bookId: String) async {}
    func remove(bookId: String) async throws { throw CloudFailure.unavailable }
}
