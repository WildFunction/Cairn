import CairnKit
import SnapKit
import UIKit

/// What a tap on the slide brings up, placed as YouTube places it. Touches that miss a control
/// fall through to the gestures underneath.
final class ControlsView: UIView {
    struct Actions {
        var back: () -> Void = {}
        var captions: () -> Void = {}
        var rate: (Double) -> Void = { _ in }
        var sleep: () -> Void = {}
        var chapters: () -> Void = {}
        var previous: () -> Void = {}
        var playPause: () -> Void = {}
        var next: () -> Void = {}
        var fullscreen: () -> Void = {}
        var scrub: (Double, Bool) -> Void = { _, _ in }
        /// Any touch on a control: the auto-hide starts over.
        var touched: () -> Void = {}
    }

    var actions = Actions()

    private let scrim = UIView()
    let back = ControlsView.button("chevron.left", size: 16, weight: .medium, id: "player.back")
    let captionsButton = ControlsView.button(image: Icons.captions(size: 24), id: "player.captions")
    let rateButton = UIButton(type: .system)
    let sleepButton = UIButton(type: .system)
    let chaptersButton = ControlsView.button("list.bullet", size: 19, id: "player.chapters")
    let previousButton = ControlsView.button("backward.end.fill", size: 22, id: "player.previous")
    let playButton = ControlsView.button("pause.fill", size: 26, id: "player.playPause")
    let nextButton = ControlsView.button("forward.end.fill", size: 22, id: "player.next")
    let fullscreenButton = ControlsView.button(image: Icons.fullscreen(size: 22, exit: false), id: "player.fullscreen")
    let timeLabel = UILabel(font: Typography.digits(12.5, .medium), color: Palette.stageInk)
    let titleLabel = UILabel(font: Typography.font(15, .semibold), color: Palette.stageInk)
    let scrubber = Scrubber()
    private let captionsMark = UIView()
    private let topRow = UIStackView()
    private let middleRow = UIStackView()

    private(set) var isFullscreen = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        scrim.backgroundColor = Palette.stageScrim.withAlphaComponent(0.58)
        scrim.isUserInteractionEnabled = false
        addSubview(scrim)
        scrim.snp.makeConstraints { $0.edges.equalToSuperview() }

        styleTextButton(rateButton, id: "player.rate")
        rateButton.showsMenuAsPrimaryAction = true
        styleTextButton(sleepButton, id: "player.sleep")
        sleepButton.setImage(Icons.symbol("moon", size: 18, weight: .medium), for: .normal)

        captionsMark.backgroundColor = Palette.stageAccent
        captionsMark.layer.cornerRadius = 1
        captionsMark.isUserInteractionEnabled = false
        captionsButton.addSubview(captionsMark)
        captionsMark.snp.makeConstraints { make in
            make.leading.trailing.equalToSuperview().inset(12)
            make.bottom.equalToSuperview().inset(7)
            make.height.equalTo(2)
        }

        titleLabel.isHidden = true
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        topRow.addArrangedSubview(back)
        topRow.addArrangedSubview(titleLabel)
        topRow.addArrangedSubview(UIView())
        for view in [captionsButton, rateButton, sleepButton, chaptersButton] { topRow.addArrangedSubview(view) }
        topRow.alignment = .center
        topRow.setCustomSpacing(4, after: back)
        chaptersButton.isHidden = true

        playButton.backgroundColor = Palette.stageScrim.withAlphaComponent(0.6)
        for view in [previousButton, playButton, nextButton] { middleRow.addArrangedSubview(view) }
        middleRow.alignment = .center
        middleRow.spacing = 34

        let bottomRow = UIStackView(arrangedSubviews: [timeLabel, UIView(), fullscreenButton])
        bottomRow.alignment = .center
        timeLabel.accessibilityIdentifier = "player.time"

        addSubview(topRow)
        addSubview(middleRow)
        addSubview(bottomRow)
        addSubview(scrubber)
        layout(bottomRow: bottomRow)
        wire()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private var bottomRow: UIStackView? { subviews.compactMap { $0 as? UIStackView }.last }

    private func layout(bottomRow: UIStackView) {
        for button in [back, captionsButton, chaptersButton, previousButton, nextButton, fullscreenButton] {
            button.snp.makeConstraints { $0.size.equalTo(44).priority(.high) }
        }
        for button in [rateButton, sleepButton] {
            button.snp.makeConstraints { make in
                make.height.equalTo(44)
                make.width.greaterThanOrEqualTo(44)
            }
        }
        playButton.snp.makeConstraints { $0.size.equalTo(52) }
        playButton.layer.cornerRadius = 26
        applyLayout()
    }

    /// Portrait sits inside the video frame; full screen spreads over the whole display.
    func setFullscreen(_ on: Bool) {
        isFullscreen = on
        titleLabel.isHidden = !on
        chaptersButton.isHidden = !on
        fullscreenButton.setImage(Icons.fullscreen(size: 22, exit: on), for: .normal)
        fullscreenButton.accessibilityLabel = L10n.text(on ? "player.exitFullscreen" : "player.fullscreen")
        back.accessibilityLabel = L10n.text(on ? "player.exitFullscreen" : "player.back")
        middleRow.spacing = on ? 64 : 34
        playButton.snp.updateConstraints { $0.size.equalTo(on ? 68 : 52) }
        playButton.layer.cornerRadius = on ? 34 : 26
        scrubber.lineHeight = on ? 4 : 3
        applyLayout()
    }

    private func applyLayout() {
        guard let bottomRow else { return }
        let on = isFullscreen
        topRow.snp.remakeConstraints { make in
            make.top.equalTo(safeAreaLayoutGuide).inset(on ? 6 : 2)
            make.leading.trailing.equalTo(safeAreaLayoutGuide).inset(on ? 14 : 2)
        }
        middleRow.snp.remakeConstraints { make in
            make.centerX.equalToSuperview()
            make.centerY.equalToSuperview().offset(on ? 0 : -8)
        }
        bottomRow.snp.remakeConstraints { make in
            make.leading.equalTo(safeAreaLayoutGuide).inset(on ? 32 : 12)
            make.trailing.equalTo(safeAreaLayoutGuide).inset(on ? 18 : 2)
            make.bottom.equalTo(safeAreaLayoutGuide).inset(on ? 34 : 6)
        }
        scrubber.snp.remakeConstraints { make in
            if on {
                make.leading.trailing.equalTo(safeAreaLayoutGuide).inset(32)
                make.centerY.equalTo(bottomRow.snp.bottom).offset(4)
            } else {
                make.leading.trailing.equalToSuperview()
                make.centerY.equalTo(snp.bottom)
            }
            make.height.equalTo(32)
        }
    }

    func show(model: PlayerModel) {
        let playing = model.isPlaying
        playButton.setImage(Icons.symbol(playing ? "pause.fill" : "play.fill", size: isFullscreen ? 30 : 26), for: .normal)
        playButton.accessibilityLabel = L10n.text(playing ? "player.pause" : "player.play")
        previousButton.isEnabled = model.hasPrevious
        previousButton.alpha = model.hasPrevious ? 1 : 0.4
        nextButton.isEnabled = model.hasNext
        nextButton.alpha = model.hasNext ? 1 : 0.4
        captionsMark.isHidden = !model.captions
        captionsButton.accessibilityLabel = L10n.text(model.captions ? "player.captions.on" : "player.captions.off")
        rateButton.setTitle(PlayerText.rate(model.rate), for: .normal)
        rateButton.accessibilityLabel = L10n.format("player.rate.label", PlayerText.rate(model.rate))
        rateButton.menu = rateMenu(current: model.rate)
        if let station = model.station {
            titleLabel.attributedText = fullscreenTitle(index: model.index, title: station.title)
        }
        showTime(model: model)
    }

    func showTime(model: PlayerModel) {
        let duration = model.durationMs
        if !scrubber.isScrubbing {
            timeLabel.text = PlayerText.time(model.positionMs, of: duration)
            scrubber.show(duration > 0 ? Double(model.positionMs) / Double(duration) : 0)
        }
        scrubber.accessibilityValue = timeLabel.text
        if let remaining = model.sleepRemaining() {
            sleepButton.setTitle(" " + L10n.clock(ms: Int(remaining * 1000)), for: .normal)
            sleepButton.accessibilityLabel = L10n.format("sleep.left", L10n.clock(ms: Int(remaining * 1000)))
        } else {
            sleepButton.setTitle(nil, for: .normal)
            sleepButton.accessibilityLabel = L10n.text("sleep.title")
        }
    }

    func showScrubPreview(ms: Int, durationMs: Int) {
        timeLabel.text = PlayerText.time(ms, of: durationMs)
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard !isHidden, alpha > 0.01 else { return nil }
        // The scrubber hangs below the frame in portrait; it still has to take a thumb there.
        let scrubPoint = convert(point, to: scrubber)
        if scrubber.point(inside: scrubPoint, with: event) { return scrubber }
        let hit = super.hitTest(point, with: event)
        return hit is UIControl ? hit : nil
    }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        super.point(inside: point, with: event) || scrubber.frame.contains(point)
    }

    private func wire() {
        let pairs: [(UIControl, () -> Void)] = [
            (back, { [weak self] in self?.actions.back() }),
            (captionsButton, { [weak self] in self?.actions.captions() }),
            (sleepButton, { [weak self] in self?.actions.sleep() }),
            (chaptersButton, { [weak self] in self?.actions.chapters() }),
            (previousButton, { [weak self] in self?.actions.previous() }),
            (playButton, { [weak self] in self?.actions.playPause() }),
            (nextButton, { [weak self] in self?.actions.next() }),
            (fullscreenButton, { [weak self] in self?.actions.fullscreen() }),
        ]
        for (control, action) in pairs {
            control.addAction(UIAction { [weak self] _ in
                self?.actions.touched()
                action()
            }, for: .primaryActionTriggered)
        }
        rateButton.addAction(UIAction { [weak self] _ in self?.actions.touched() }, for: .menuActionTriggered)
        scrubber.onScrub = { [weak self] value, done in
            self?.actions.touched()
            self?.actions.scrub(value, done)
        }
    }

    private func rateMenu(current: Double) -> UIMenu {
        UIMenu(title: L10n.text("player.speed"), options: .singleSelection, children: PlaybackRules.rates.map { rate in
            UIAction(title: PlayerText.rate(rate), state: rate == current ? .on : .off) { [weak self] _ in
                self?.actions.touched()
                self?.actions.rate(rate)
            }
        })
    }

    private func fullscreenTitle(index: Int, title: String) -> NSAttributedString {
        let text = NSMutableAttributedString(
            string: L10n.format("player.stationNo", index + 1) + "  ",
            attributes: [.font: Typography.font(12, .semibold), .foregroundColor: Palette.stageDim, .kern: 0.7])
        text.append(NSAttributedString(string: title, attributes: [.font: Typography.font(15, .semibold), .foregroundColor: Palette.stageInk]))
        return text
    }

    private func styleTextButton(_ button: UIButton, id: String) {
        button.tintColor = Palette.stageInk
        button.setTitleColor(Palette.stageInk, for: .normal)
        button.titleLabel?.font = Typography.digits(14, .semibold)
        button.contentEdgeInsets = UIEdgeInsets(top: 0, left: 10, bottom: 0, right: 10)
        button.accessibilityIdentifier = id
    }

    private static func button(_ symbol: String, size: CGFloat, weight: UIImage.SymbolWeight = .semibold, id: String) -> UIButton {
        button(image: Icons.symbol(symbol, size: size, weight: weight), id: id)
    }

    private static func button(image: UIImage?, id: String) -> UIButton {
        let button = UIButton(type: .system)
        button.setImage(image, for: .normal)
        button.tintColor = Palette.stageInk
        button.accessibilityIdentifier = id
        button.accessibilityLabel = L10n.text(id)
        return button
    }
}
