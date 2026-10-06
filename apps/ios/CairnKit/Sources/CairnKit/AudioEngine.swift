import Foundation

/// What the lock screen shows for a station.
public struct NowPlaying: Equatable, Sendable {
    public let title: String
    public let album: String
    public let artwork: URL?
}

/// A command from outside the app: the lock screen, headphones, a car.
public enum RemoteAction: Equatable, Sendable {
    case play, pause, toggle
    case skip(seconds: Double)
    case seek(ms: Int)
}

public enum AudioEvent: Equatable, Sendable {
    /// The engine started or stopped making sound, for any reason — including a call or a pulled headphone.
    case playing(Bool)
    case ended
    case failed(String)
    case remote(RemoteAction)
}

/// The sound, as the player sees it. The app supplies the implementation; tests use a fake.
@MainActor
public protocol AudioEngine: AnyObject {
    var onEvent: ((AudioEvent) -> Void)? { get set }
    var positionMs: Int { get }
    func load(_ url: URL, startMs: Int, play: Bool, info: NowPlaying)
    func play()
    func pause()
    func stop()
    func seek(toMs ms: Int)
    func setRate(_ rate: Double)
    func setVolume(_ volume: Float)
}

/// Seconds that only move forward, and the wall clock for stamping a place.
public protocol PlayerClock: Sendable {
    var now: Double { get }
    var epochMs: Int { get }
}

public struct SystemClock: PlayerClock {
    public init() {}
    public var now: Double { ProcessInfo.processInfo.systemUptime }
    public var epochMs: Int { Int(Date().timeIntervalSince1970 * 1000) }
}

/// What the reader chose and expects to find again next launch.
public struct PlayerPreferences: Codable, Equatable, Sendable {
    public var rate: Double
    public var captions: Bool
    public var autoplay: Bool

    public init(rate: Double = 1, captions: Bool = true, autoplay: Bool = true) {
        self.rate = rate
        self.captions = captions
        self.autoplay = autoplay
    }
}

public protocol PreferenceStore: AnyObject {
    var player: PlayerPreferences { get set }
}

public final class MemoryPreferences: PreferenceStore {
    public var player: PlayerPreferences
    public init(_ player: PlayerPreferences = PlayerPreferences()) { self.player = player }
}
