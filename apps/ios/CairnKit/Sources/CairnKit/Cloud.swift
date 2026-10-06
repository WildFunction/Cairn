import Foundation

public enum CloudAccount: Equatable, Sendable {
    case available, noAccount, restricted, temporarilyUnavailable, unknown
}

/// One thing iCloud says changed, already in the library's words.
public enum CloudChange: Sendable, Equatable {
    case station(bookId: String, nodeId: String, deck: String, audio: URL, fingerprint: String)
    case book(bookId: String, manifest: String, cover: URL?, fingerprint: String)
    case progress(bookId: String, place: Place)
    case recordRemoved(bookId: String, name: String)
    case zoneRemoved(bookId: String)
}

/// What the cloud hands its changes to. Asset files named in a change are only promised to exist until `apply` returns.
public protocol CloudReceiver: AnyObject, Sendable {
    func apply(_ change: CloudChange) async
}

/// The owner's private database, as the phone sees it. CloudKit is the one implementation; tests use a fake.
public protocol CloudBooks: AnyObject, Sendable {
    func account() async -> CloudAccount
    /// Every change the server has is passed to the receiver before this returns.
    func fetchChanges() async throws
    /// Queue the reader's place for the book's zone. Sending is the implementation's business.
    func send(progress: Place, bookId: String) async
    /// Take the book out of iCloud, and so off every device. Returns once iCloud has agreed and the
    /// receiver has been told; throws, with nothing changed, when it could not be done.
    func remove(bookId: String) async throws
}

public enum CloudFailure: Error, Equatable {
    /// This build or this account cannot reach iCloud at all.
    case unavailable
}

/// The names `packages/core/src/sync/book.ts` gives things.
public enum CloudNames {
    public static let bookRecord = "book"
    public static let progressRecord = "progress"
    public static let stationType = "Station"
    public static let bookType = "Book"
    public static let progressType = "Progress"

    private static let zonePrefix = "book_"

    public static func zone(of bookId: String) -> String { zonePrefix + bookId }

    public static func bookId(ofZone zone: String) -> String? {
        guard zone.hasPrefix(zonePrefix) else { return nil }
        let id = String(zone.dropFirst(zonePrefix.count))
        return BookLibrary.isBookId(id) ? id : nil
    }
}
