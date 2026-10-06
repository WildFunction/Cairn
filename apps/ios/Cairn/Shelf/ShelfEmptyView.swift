import CairnKit
import SnapKit
import UIKit

/// What the shelf says when it holds nothing: where books come from, and whether iCloud can bring them.
final class ShelfEmptyView: UIView {
    var onCheckAgain: (() -> Void)?

    private let glyph = CairnGlyphView()
    private let titleLabel = UILabel(font: Typography.font(20, .bold, relativeTo: .title3), color: Palette.ink, lines: 0)
    private let bodyLabel = UILabel(font: Typography.font(15, relativeTo: .subheadline), color: Palette.dim, lines: 0)
    private let button = UIButton(configuration: .bordered())
    private let accountDot = UIView()
    private let accountLabel = UILabel(font: Typography.font(12, relativeTo: .caption1), color: Palette.dim, lines: 0)

    override init(frame: CGRect) {
        super.init(frame: frame)
        titleLabel.text = L10n.text("shelf.empty.title")
        titleLabel.textAlignment = .center
        bodyLabel.text = L10n.text("shelf.empty.body")
        bodyLabel.textAlignment = .center

        var configuration = UIButton.Configuration.bordered()
        configuration.title = L10n.text("shelf.empty.check")
        configuration.cornerStyle = .capsule
        configuration.baseBackgroundColor = .clear
        configuration.baseForegroundColor = Palette.accent
        configuration.background.strokeColor = Palette.line
        configuration.background.strokeWidth = 1
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var next = attributes
            next.font = Typography.font(15, .semibold, relativeTo: .subheadline)
            return next
        }
        button.configuration = configuration
        button.accessibilityIdentifier = "shelf.checkAgain"
        button.addAction(UIAction { [weak self] _ in self?.onCheckAgain?() }, for: .primaryActionTriggered)

        let stack = UIStackView(arrangedSubviews: [glyph, titleLabel, bodyLabel, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        stack.setCustomSpacing(20, after: glyph)
        stack.setCustomSpacing(22, after: bodyLabel)

        accountDot.layer.cornerRadius = 3
        let account = UIStackView(arrangedSubviews: [accountDot, accountLabel])
        account.spacing = 6
        account.alignment = .center

        addSubview(stack)
        addSubview(account)
        glyph.snp.makeConstraints { $0.size.equalTo(84) }
        accountDot.snp.makeConstraints { $0.size.equalTo(6) }
        stack.snp.makeConstraints { make in
            make.leading.trailing.equalToSuperview().inset(40)
            make.centerY.equalToSuperview().offset(-40)
        }
        account.snp.makeConstraints { make in
            make.centerX.equalToSuperview()
            make.leading.greaterThanOrEqualToSuperview().inset(24)
            make.bottom.equalTo(safeAreaLayoutGuide).inset(16)
        }
        show(account: .unknown)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(account: CloudAccount) {
        accountLabel.text = L10n.account(account)
        accountDot.backgroundColor = account == .available ? Palette.done : Palette.lock
    }
}

/// Four stacked stones, drawn rather than shipped as an image.
final class CairnGlyphView: UIView {
    override class var layerClass: AnyClass { CAShapeLayer.self }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = false
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: CairnGlyphView, _) in view.setNeedsLayout() }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let shape = layer as? CAShapeLayer else { return }
        // Centre x, centre y, radius x, radius y — in the mock's 84-unit box.
        let stones: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [(42, 66, 26, 9), (42, 46, 18, 8), (42, 29, 12, 6.5), (42, 15.5, 6.5, 4.5)]
        let unit = bounds.width / 84
        let path = UIBezierPath()
        for (x, y, rx, ry) in stones {
            path.append(UIBezierPath(ovalIn: CGRect(x: (x - rx) * unit, y: (y - ry) * unit, width: rx * 2 * unit, height: ry * 2 * unit)))
        }
        shape.path = path.cgPath
        shape.fillColor = nil
        shape.lineWidth = 2.4 * unit
        shape.strokeColor = Palette.lock.resolvedColor(with: traitCollection).cgColor
    }
}
