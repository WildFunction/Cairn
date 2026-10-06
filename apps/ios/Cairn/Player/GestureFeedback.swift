import SnapKit
import UIKit

/// The lit arc on the tapped side of a double tap, with the running total on it.
final class SeekArcView: UIView {
    enum Side { case back, forward }

    private let shape = CAShapeLayer()
    private let arrows = UIStackView()
    private let label = UILabel(font: Typography.digits(12.5, .semibold), color: Palette.stageInk)
    private var hideWork: DispatchWorkItem?
    let side: Side

    init(side: Side) {
        self.side = side
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        alpha = 0
        isAccessibilityElement = true
        accessibilityIdentifier = side == .forward ? "player.seekArc.forward" : "player.seekArc.back"
        shape.fillColor = UIColor(white: 1, alpha: 0.15).cgColor
        layer.addSublayer(shape)

        for (index, opacity) in [0.45, 0.75, 1].enumerated() {
            let arrow = UIImageView(image: Icons.symbol("arrowtriangle.right.fill", size: 12))
            arrow.tintColor = Palette.stageInk
            arrow.alpha = side == .forward ? opacity : [1, 0.75, 0.45][index]
            if side == .back { arrow.transform = CGAffineTransform(scaleX: -1, y: 1) }
            arrows.addArrangedSubview(arrow)
        }
        let stack = UIStackView(arrangedSubviews: [arrows, label])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 4
        addSubview(stack)
        stack.snp.makeConstraints { $0.center.equalToSuperview() }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        // An ellipse twice the view's width, clipped by it: the edge facing the middle is the arc.
        let x = side == .forward ? 0 : -bounds.width
        shape.path = UIBezierPath(ovalIn: CGRect(x: x, y: -bounds.height * 0.1, width: bounds.width * 2, height: bounds.height * 1.2)).cgPath
        clipsToBounds = true
    }

    func show(seconds: Int) {
        label.text = L10n.format("player.seek.seconds", seconds)
        accessibilityValue = label.text
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.fade(to: 0) }
        hideWork = work
        fade(to: 1)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
        UIAccessibility.post(notification: .announcement, argument: label.text)
    }

    private func fade(to alpha: CGFloat) {
        if UIAccessibility.isReduceMotionEnabled {
            self.alpha = alpha
        } else {
            UIView.animate(withDuration: 0.15) { self.alpha = alpha }
        }
    }
}

/// `2× speed ▸▸▸` at the top of the slide while a long press holds.
final class HoldPill: UIView {
    private let label = UILabel(font: Typography.digits(13, .semibold), color: Palette.stageInk)

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = Palette.stageScrim.withAlphaComponent(0.85)
        layer.cornerRadius = 15
        let arrows = UIStackView(arrangedSubviews: [0.45, 0.75, 1].map { opacity in
            let arrow = UIImageView(image: Icons.symbol("arrowtriangle.right.fill", size: 10))
            arrow.tintColor = Palette.stageInk
            arrow.alpha = opacity
            return arrow
        })
        let stack = UIStackView(arrangedSubviews: [label, arrows])
        stack.spacing = 4
        stack.alignment = .center
        addSubview(stack)
        stack.snp.makeConstraints { make in
            make.edges.equalToSuperview().inset(UIEdgeInsets(top: 6, left: 13, bottom: 6, right: 10))
        }
        accessibilityIdentifier = "player.holdPill"
        isAccessibilityElement = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(rate: Double) {
        label.text = L10n.format("player.hold", rate.formatted(.number.precision(.fractionLength(0...2))))
        accessibilityLabel = label.text
    }
}
