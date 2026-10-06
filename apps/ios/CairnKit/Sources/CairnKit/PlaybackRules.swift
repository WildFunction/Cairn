import Foundation

/// The arithmetic of playback, shared with the desktop where the desktop has the same rule.
public enum PlaybackRules {
    /// `RATES` in `packages/ui/src/panes/useTransport.ts`.
    public static let rates: [Double] = [0.75, 1, 1.25, 1.5, 2, 3]
    /// One double tap.
    public static let seekStepSeconds = 10
    /// A finished book stays `Finished` until this much of it has been heard again: opening it to look is not re-reading it.
    public static let rereadMs = 60_000
    /// Movement between two ticks larger than this is a seek, not listening.
    static let listenedStepMs = 2_000

    /// Resuming this close to a station's start is not worth a mid-sentence entry (`resume.ts`).
    static let floorMs = 8_000
    /// Nor this close to its end: the station is effectively finished.
    static let tailMs = 5_000

    /// `startAt` in `packages/ui/src/panes/resume.ts`. A length of 0 means unknown: only the floor applies.
    public static func startAt(_ place: Place?, nodeId: String, durationMs: Int) -> Int {
        guard let place, place.nodeId == nodeId, place.ms >= floorMs else { return 0 }
        if durationMs > 0 && place.ms > durationMs - tailMs { return 0 }
        return place.ms
    }

    /// A hold should always be faster than the chosen speed.
    public static func holdRate(chosen: Double) -> Double {
        chosen >= 2 ? 3 : 2
    }
}

/// The running total a run of double taps on one side shows: `10 s`, `20 s`, `30 s`.
public struct SeekTally: Sendable {
    public enum Side: Sendable { case back, forward }

    /// Taps further apart than this are a new run.
    static let window = 1.0

    private var side: Side?
    private var total = 0
    private var lastAt = -Double.infinity

    public init() {}

    public mutating func tap(_ side: Side, now: Double) -> Int {
        if side != self.side || now - lastAt > Self.window { total = 0 }
        self.side = side
        lastAt = now
        total += PlaybackRules.seekStepSeconds
        return total
    }
}

/// When a reader's place goes to disk and when to iCloud.
public struct PlaceSchedule: Sendable {
    static let diskEveryMs = 5_000
    static let cloudEverySeconds = 30.0

    private var stored: Place?
    private var sentAt = -Double.infinity

    public init() {}

    public mutating func shouldStore(_ place: Place, now: Double, force: Bool) -> (disk: Bool, cloud: Bool) {
        let moved = stored.map { $0.nodeId != place.nodeId || abs(place.ms - $0.ms) >= Self.diskEveryMs } ?? true
        let disk = force || moved
        if disk { stored = place }
        let cloud = force || now - sentAt >= Self.cloudEverySeconds
        if cloud { sentAt = now }
        return (disk, cloud)
    }
}

public struct SleepTimer: Equatable, Sendable {
    public enum Mode: Equatable, Sendable {
        case off
        case minutes(Int)
        case endOfChapter
    }

    public static let choices: [Mode] = [.off, .minutes(15), .minutes(30), .minutes(45), .minutes(60), .endOfChapter]
    static let fadeSeconds = 5.0

    public let mode: Mode
    let deadline: Double?

    public static let off = SleepTimer(mode: .off, deadline: nil)

    public static func start(_ mode: Mode, now: Double) -> SleepTimer {
        if case .minutes(let minutes) = mode { return SleepTimer(mode: mode, deadline: now + Double(minutes) * 60) }
        return SleepTimer(mode: mode, deadline: nil)
    }

    /// Seconds of listening left, or nothing while off.
    public func remaining(now: Double, stationRemainingMs: Int, rate: Double) -> Double? {
        switch mode {
        case .off: return nil
        case .minutes: return max(0, (deadline ?? now) - now)
        case .endOfChapter: return max(0, Double(stationRemainingMs) / 1000 / max(rate, 0.01))
        }
    }

    public static func volume(remaining: Double?) -> Float {
        guard let remaining, remaining < fadeSeconds else { return 1 }
        return Float(max(0, remaining) / fadeSeconds)
    }
}
