import CairnKit
import SnapKit
import UIKit

/// One book on the shelf: cover, title, a line of facts, the intro, and where its reader is.
final class BookCardCell: UICollectionViewCell {
    static let height: CGFloat = 136
    private static let coverWidth = (height * 11 / 15).rounded()

    private let cover = CoverView()
    private let coverEdge = UIView()
    private let titleLabel = UILabel(font: Typography.font(17, .semibold, relativeTo: .headline), color: Palette.ink)
    private let tagLabel = TagLabel()
    private let metaLabel = UILabel(font: Typography.font(13, relativeTo: .footnote), color: Palette.dim)
    private let introLabel = UILabel(font: Typography.font(13, relativeTo: .footnote), color: Palette.dim, lines: 2)
    private let bar = ProgressBar()
    private let footIcon = UIImageView()
    private let footLabel = UILabel(font: Typography.digits(12, relativeTo: .caption1), color: Palette.inkQuiet)

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = Palette.card
        contentView.layer.cornerRadius = 12
        contentView.layer.cornerCurve = .continuous
        contentView.layer.borderWidth = 1
        contentView.clipsToBounds = true
        coverEdge.backgroundColor = Palette.line

        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tagLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
        tagLabel.setContentHuggingPriority(.required, for: .horizontal)
        let titleRow = UIStackView(arrangedSubviews: [titleLabel, tagLabel, UIView()])
        titleRow.spacing = 6
        titleRow.alignment = .center

        footIcon.contentMode = .scaleAspectFit
        footIcon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11, weight: .bold)
        footLabel.setContentHuggingPriority(.required, for: .horizontal)
        footLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
        let footRow = UIStackView(arrangedSubviews: [footIcon, bar, footLabel, UIView()])
        footRow.spacing = 10
        footRow.setCustomSpacing(5, after: footIcon)
        footRow.alignment = .center

        let text = UIStackView(arrangedSubviews: [titleRow, metaLabel, introLabel, UIView(), footRow])
        text.axis = .vertical
        text.setCustomSpacing(2, after: titleRow)
        text.setCustomSpacing(6, after: metaLabel)

        contentView.addSubview(cover)
        contentView.addSubview(coverEdge)
        contentView.addSubview(text)
        cover.snp.makeConstraints { make in
            make.leading.top.bottom.equalToSuperview()
            make.width.equalTo(Self.coverWidth)
        }
        coverEdge.snp.makeConstraints { make in
            make.leading.equalTo(cover.snp.trailing)
            make.top.bottom.equalToSuperview()
            make.width.equalTo(1)
        }
        text.snp.makeConstraints { make in
            make.leading.equalTo(coverEdge.snp.trailing).offset(14)
            make.trailing.equalToSuperview().inset(14)
            make.top.bottom.equalToSuperview().inset(12)
        }
        contentView.snp.makeConstraints { make in
            make.edges.equalToSuperview()
            make.height.greaterThanOrEqualTo(Self.height)
        }
        bar.snp.makeConstraints { $0.height.equalTo(4) }

        isAccessibilityElement = true
        accessibilityTraits = .button
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (cell: BookCardCell, _) in cell.applyBorder() }
        applyBorder()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isHighlighted: Bool {
        didSet { contentView.alpha = isHighlighted ? 0.7 : 1 }
    }

    func show(_ book: LibraryBook) {
        let title = ShelfText.title(book)
        cover.show(cover: book.cover, title: title)
        titleLabel.text = title
        tagLabel.text = L10n.text("shelf.builtIn")
        tagLabel.isHidden = !book.isBuiltIn
        metaLabel.text = ShelfText.meta(book)
        metaLabel.isHidden = metaLabel.text == nil
        introLabel.text = book.manifest?.intro
        introLabel.isHidden = (book.manifest?.intro ?? "").isEmpty
        show(foot: book.foot)

        // A book still arriving reads as not quite here yet.
        let arriving = !book.isComplete
        for view in [cover, titleLabel, metaLabel] as [UIView] { view.alpha = arriving ? 0.6 : 1 }
        accessibilityLabel = ShelfText.accessibilityLabel(book)
        accessibilityIdentifier = "shelf.book.\(book.id)"
    }

    private func show(foot: ShelfFoot) {
        footLabel.text = ShelfText.foot(foot)
        footLabel.font = Typography.digits(12, relativeTo: .caption1)
        footIcon.isHidden = true
        bar.isHidden = true
        switch foot {
        case .needsUpdate:
            footLabel.textColor = Palette.accent
        case .downloading(let have, let total):
            footLabel.textColor = Palette.accent
            bar.isHidden = false
            bar.show(fraction: total > 0 ? Double(have) / Double(total) : 0, dashed: true)
        case .notStarted:
            footLabel.textColor = Palette.dim
        case .finished:
            footLabel.textColor = Palette.done
            footLabel.font = Typography.digits(12, .semibold, relativeTo: .caption1)
            footIcon.image = UIImage(systemName: "checkmark")
            footIcon.tintColor = Palette.done
            footIcon.isHidden = false
        case .progress(_, _, let fraction):
            footLabel.textColor = Palette.inkQuiet
            bar.isHidden = false
            bar.show(fraction: fraction, dashed: false)
        }
    }

    private func applyBorder() {
        contentView.layer.borderColor = Palette.line.resolvedColor(with: traitCollection).cgColor
    }
}

/// The small outlined `Built-in` mark after a title.
final class TagLabel: UILabel {
    override init(frame: CGRect) {
        super.init(frame: frame)
        font = Typography.font(10.5, .semibold, relativeTo: .caption2)
        textColor = Palette.dim
        textAlignment = .center
        layer.cornerRadius = 5
        layer.borderWidth = 1
        adjustsFontForContentSizeCategory = true
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (label: TagLabel, _) in label.applyBorder() }
        applyBorder()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(width: size.width + 12, height: size.height + 2)
    }

    private func applyBorder() {
        layer.borderColor = Palette.line.resolvedColor(with: traitCollection).cgColor
    }
}

/// A 4 pt track. Dashed while the thing it measures is a download, not reading.
final class ProgressBar: UIView {
    private let fill = CAShapeLayer()
    private var fraction = 0.0
    private var dashed = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Palette.line
        layer.cornerRadius = 2
        clipsToBounds = true
        fill.fillColor = nil
        layer.addSublayer(fill)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(fraction: Double, dashed: Bool) {
        self.fraction = min(1, max(0, fraction))
        self.dashed = dashed
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let path = UIBezierPath()
        path.move(to: CGPoint(x: 0, y: bounds.midY))
        path.addLine(to: CGPoint(x: bounds.width * fraction, y: bounds.midY))
        fill.path = path.cgPath
        fill.lineWidth = bounds.height
        fill.lineDashPattern = dashed ? [6, 3] : nil
        fill.strokeColor = Palette.accent.resolvedColor(with: traitCollection).cgColor
    }
}
