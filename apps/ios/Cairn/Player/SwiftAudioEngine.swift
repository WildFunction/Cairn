import AVFoundation
import CairnKit
import MediaPlayer
import os
import SwiftAudioEx
import UIKit

/// `AudioEngine` on SwiftAudioEx, which brings Now Playing and the remote commands with it.
/// If it misbehaves, write the same on `AVPlayer` and swap it in `AppEnvironment`.
@MainActor
final class SwiftAudioEngine: AudioEngine {
    var onEvent: ((AudioEvent) -> Void)?

    private let player = AudioPlayer()
    private let gain: Float
    private let log = Logger(subsystem: "dev.jasper.cairn", category: "audio")

    /// `gain` 0 keeps a scripted simulator run quiet without changing anything else.
    init(gain: Float = 1) {
        self.gain = gain
        player.audioTimePitchAlgorithm = .timeDomain
        player.automaticallyUpdateNowPlayingInfo = true
        player.volume = gain
        player.remoteCommands = [
            .play, .pause, .togglePlayPause, .changePlaybackPosition,
            .skipForward(preferredIntervals: [NSNumber(value: PlaybackRules.seekStepSeconds)]),
            .skipBackward(preferredIntervals: [NSNumber(value: PlaybackRules.seekStepSeconds)]),
        ]
        routeRemoteCommands()
        listen()
    }

    var positionMs: Int { Int((player.currentTime * 1000).rounded()) }

    func load(_ url: URL, startMs: Int, play: Bool, info: NowPlaying) {
        activateSession()
        let item = StationItem(url: url, info: info, initialTime: Double(startMs) / 1000)
        player.load(item: item, playWhenReady: play)
    }

    func play() {
        activateSession()
        player.play()
    }

    func pause() { player.pause() }
    func stop() { player.stop() }
    func seek(toMs ms: Int) { player.seek(to: Double(ms) / 1000) }
    func setRate(_ rate: Double) { player.rate = Float(rate) }
    func setVolume(_ volume: Float) { player.volume = volume * gain }

    private func activateSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
        } catch {
            log.error("audio session refused: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func failed(_ message: String) {
        log.error("playback failed: \(message, privacy: .public)")
        emit(.failed(message))
    }

    private func emit(_ event: AudioEvent) {
        onEvent?(event)
    }

    /// SwiftAudioEx fires its events off the main thread.
    private func listen() {
        player.event.stateChange.addListener(self) { @Sendable [weak self] state in
            let playing: Bool? = switch state {
            case .playing: true
            case .paused, .stopped, .ended, .failed, .idle: false
            case .loading, .buffering, .ready: nil
            @unknown default: nil
            }
            guard let playing else { return }
            DispatchQueue.main.async { self?.emit(.playing(playing)) }
        }
        player.event.playbackEnd.addListener(self) { @Sendable [weak self] reason in
            guard reason == .playedUntilEnd else { return }
            DispatchQueue.main.async { self?.emit(.ended) }
        }
        player.event.fail.addListener(self) { @Sendable [weak self] error in
            let message = error.map { String(describing: $0) } ?? "unknown"
            DispatchQueue.main.async { self?.failed(message) }
        }
    }

    /// Every outside command goes through `PlayerModel`, so the place is stored the same way as a tap.
    private func routeRemoteCommands() {
        let remote = player.remoteCommandController
        let send: @Sendable (RemoteAction) -> MPRemoteCommandHandlerStatus = { [weak self] action in
            DispatchQueue.main.async { self?.emit(.remote(action)) }
            return .success
        }
        remote.handlePlayCommand = { @Sendable _ in send(.play) }
        remote.handlePauseCommand = { @Sendable _ in send(.pause) }
        remote.handleTogglePlayPauseCommand = { @Sendable _ in send(.toggle) }
        remote.handleSkipForwardCommand = { @Sendable event in
            send(.skip(seconds: (event as? MPSkipIntervalCommandEvent)?.interval ?? Double(PlaybackRules.seekStepSeconds)))
        }
        remote.handleSkipBackwardCommand = { @Sendable event in
            send(.skip(seconds: -((event as? MPSkipIntervalCommandEvent)?.interval ?? Double(PlaybackRules.seekStepSeconds))))
        }
        remote.handleChangePlaybackPositionCommand = { @Sendable event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            return send(.seek(ms: Int(event.positionTime * 1000)))
        }
    }
}

private final class StationItem: AudioItem, InitialTiming, TimePitching {
    private let url: String
    private let title: String
    private let album: String
    private let artwork: UIImage?
    private let initialTime: TimeInterval

    init(url: URL, info: NowPlaying, initialTime: TimeInterval) {
        self.url = url.path
        title = info.title
        album = info.album
        artwork = info.artwork.flatMap { UIImage(contentsOfFile: $0.path) }
        self.initialTime = initialTime
    }

    func getSourceUrl() -> String { url }
    func getArtist() -> String? { nil }
    func getTitle() -> String? { title }
    func getAlbumTitle() -> String? { album }
    func getSourceType() -> SourceType { .file }
    func getArtwork(_ handler: @escaping (UIImage?) -> Void) { handler(artwork) }
    func getInitialTime() -> TimeInterval { initialTime }
    func getPitchAlgorithmType() -> AVAudioTimePitchAlgorithm { .timeDomain }
}
