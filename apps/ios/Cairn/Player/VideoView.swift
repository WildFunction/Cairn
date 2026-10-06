import CairnKit
import SnapKit
import UIKit

/// The picture and everything drawn over it: the slide, the progress line, the controls, and the
/// gestures YouTube taught everyone. The slide keeps 16:9 and letterboxes in whatever it is given.
final class VideoView: UIView {
    let stage = StageView()
    let controls = ControlsView()
    let backArc = SeekArcView(side: .back)
    let forwardArc = SeekArcView(side: .forward)
    let holdPill = HoldPill()
    private let progressTrack = UIView()
    private let progressFill = UIView()
    private var progress = 0.0

    var onTap: (() -> Void)?
    var onDoubleTap: ((SeekArcView.Side) -> Void)?
    var onHold: ((Bool) -> Void)?

    private let singleTap = UITapGestureRecognizer()
    private let doubleTap = UITapGestureRecognizer()
    private let longPress = UILongPressGestureRecognizer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Palette.stage
        progressTrack.backgroundColor = UIColor(white: 1, alpha: 0.15)
        progressFill.backgroundColor = Palette.stageAccent
        progressTrack.isUserInteractionEnabled = false
        progressTrack.addSubview(progressFill)
        holdPill.isHidden = true

        for view in [stage, progressTrack, backArc, forwardArc, holdPill, controls] as [UIView] { addSubview(view) }
        stage.snp.makeConstraints { make in
            make.center.equalToSuperview()
            make.width.equalTo(stage.snp.height).multipliedBy(16.0 / 9.0)
            make.width.lessThanOrEqualToSuperview()
            make.height.lessThanOrEqualToSuperview()
            make.width.equalToSuperview().priority(.high)
            make.height.equalToSuperview().priority(.high)
        }
        progressTrack.snp.makeConstraints { make in
            make.leading.trailing.bottom.equalTo(stage)
            make.height.equalTo(3)
        }
        backArc.snp.makeConstraints { make in
            make.leading.top.bottom.equalTo(stage)
            make.width.equalTo(stage).multipliedBy(0.44)
        }
        forwardArc.snp.makeConstraints { make in
            make.trailing.top.bottom.equalTo(stage)
            make.width.equalTo(stage).multipliedBy(0.44)
        }
        holdPill.snp.makeConstraints { make in
            make.centerX.equalTo(stage)
            make.top.equalTo(stage).inset(10)
        }
        controls.snp.makeConstraints { $0.edges.equalToSuperview() }
        installGestures()

        isAccessibilityElement = false
        accessibilityIdentifier = "player.video"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func setFullscreen(_ on: Bool) {
        backgroundColor = on ? .black : Palette.stage
        controls.setFullscreen(on)
    }

    func showProgress(_ fraction: Double) {
        progress = min(1, max(0, fraction))
        setNeedsLayout()
    }

    func setControlsShown(_ shown: Bool) {
        progressTrack.isHidden = shown
        stage.lifted = shown
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        progressFill.frame = CGRect(x: 0, y: 0, width: progressTrack.bounds.width * progress, height: progressTrack.bounds.height)
    }

    /// The portrait scrubber hangs below the frame and must still take a touch there.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        super.point(inside: point, with: event) || controls.point(inside: convert(point, to: controls), with: event)
    }

    private func installGestures() {
        doubleTap.numberOfTapsRequired = 2
        doubleTap.addTarget(self, action: #selector(didDoubleTap(_:)))
        singleTap.addTarget(self, action: #selector(didTap))
        // A single tap waits to learn it was not the first half of a double.
        singleTap.require(toFail: doubleTap)
        longPress.minimumPressDuration = 0.45
        longPress.addTarget(self, action: #selector(didLongPress(_:)))
        for recognizer in [singleTap, doubleTap, longPress] as [UIGestureRecognizer] { addGestureRecognizer(recognizer) }
    }

    @objc private func didTap() { onTap?() }

    @objc private func didDoubleTap(_ recognizer: UITapGestureRecognizer) {
        let x = recognizer.location(in: stage).x
        onDoubleTap?(x < stage.bounds.midX ? .back : .forward)
    }

    @objc private func didLongPress(_ recognizer: UILongPressGestureRecognizer) {
        switch recognizer.state {
        case .began:
            // A hold is never also a tap.
            singleTap.isEnabled = false
            singleTap.isEnabled = true
            onHold?(true)
        case .ended, .cancelled, .failed:
            onHold?(false)
        default:
            break
        }
    }
}
