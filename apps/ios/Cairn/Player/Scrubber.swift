import UIKit

/// The progress line that becomes a scrubber with a thumb. Taller than it looks, so a thumb can find it.
final class Scrubber: UIControl {
    /// While the reader drags, the position under their finger; the player follows on release.
    private(set) var value: Double = 0
    private(set) var isScrubbing = false
    var lineHeight: CGFloat = 3 { didSet { setNeedsLayout() } }
    var showsThumb = true { didSet { thumb.isHidden = !showsThumb } }
    var onScrub: ((Double, Bool) -> Void)?

    private let track = UIView()
    private let fill = UIView()
    private let thumb = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        track.backgroundColor = UIColor(white: 1, alpha: 0.25)
        fill.backgroundColor = Palette.stageAccent
        thumb.backgroundColor = Palette.stageAccent
        thumb.layer.cornerRadius = 6.5
        for view in [track, fill, thumb] {
            view.isUserInteractionEnabled = false
            addSubview(view)
        }
        isAccessibilityElement = true
        accessibilityTraits = .adjustable
        accessibilityLabel = L10n.text("player.scrubber")
        accessibilityIdentifier = "player.scrubber"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(_ fraction: Double) {
        guard !isScrubbing else { return }
        value = min(1, max(0, fraction))
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let y = bounds.midY - lineHeight / 2
        track.frame = CGRect(x: 0, y: y, width: bounds.width, height: lineHeight)
        fill.frame = CGRect(x: 0, y: y, width: bounds.width * value, height: lineHeight)
        track.layer.cornerRadius = lineHeight > 3 ? lineHeight / 2 : 0
        fill.layer.cornerRadius = track.layer.cornerRadius
        let size: CGFloat = isScrubbing ? 18 : 13
        thumb.layer.cornerRadius = size / 2
        thumb.frame = CGRect(x: bounds.width * value - size / 2, y: bounds.midY - size / 2, width: size, height: size)
    }

    override func beginTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
        isScrubbing = true
        move(to: touch)
        return true
    }

    override func continueTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
        move(to: touch)
        return true
    }

    override func endTracking(_ touch: UITouch?, with event: UIEvent?) {
        if let touch { move(to: touch) }
        isScrubbing = false
        onScrub?(value, true)
        setNeedsLayout()
    }

    override func cancelTracking(with event: UIEvent?) {
        isScrubbing = false
        onScrub?(value, true)
    }

    override func accessibilityIncrement() { step(by: 0.05) }
    override func accessibilityDecrement() { step(by: -0.05) }

    private func step(by delta: Double) {
        value = min(1, max(0, value + delta))
        onScrub?(value, true)
    }

    private func move(to touch: UITouch) {
        value = min(1, max(0, Double(touch.location(in: self).x / max(bounds.width, 1))))
        onScrub?(value, false)
        setNeedsLayout()
    }
}
