import Foundation

/// Where a reader stopped, and when: the same shape as the `Progress` record in iCloud.
public struct Place: Codable, Equatable, Sendable {
    public let nodeId: String
    public let ms: Int
    /// Epoch milliseconds.
    public let updatedAt: Int
    public let device: String

    public init(nodeId: String, ms: Int, updatedAt: Int, device: String) {
        self.nodeId = nodeId
        self.ms = max(0, ms)
        self.updatedAt = updatedAt
        self.device = device
    }
}

/// `state.json`: what this device knows about a book that the book itself does not say.
public struct BookState: Codable, Equatable, Sendable {
    /// Fingerprints of the Station records on disk, by node id.
    public let stations: [String: String]
    /// The Book record's fingerprint.
    public let book: String?
    public let place: Place?
    public let finished: Bool

    public static let empty = BookState()

    public init(stations: [String: String] = [:], book: String? = nil, place: Place? = nil, finished: Bool = false) {
        self.stations = stations
        self.book = book
        self.place = place
        self.finished = finished
    }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        stations = try box.decodeIfPresent([String: String].self, forKey: .stations) ?? [:]
        book = try box.decodeIfPresent(String.self, forKey: .book)
        place = try box.decodeIfPresent(Place.self, forKey: .place)
        finished = try box.decodeIfPresent(Bool.self, forKey: .finished) ?? false
    }

    public func with(
        stations: [String: String]? = nil, book: String?? = nil, place: Place?? = nil, finished: Bool? = nil
    ) -> BookState {
        BookState(
            stations: stations ?? self.stations,
            book: book ?? self.book,
            place: place ?? self.place,
            finished: finished ?? self.finished
        )
    }
}
