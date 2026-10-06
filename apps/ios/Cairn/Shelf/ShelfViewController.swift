import CairnKit
import SnapKit
import UIKit

/// The books on this phone, one card each. Tapping one opens the player; there is no screen in between.
final class ShelfViewController: UIViewController, UICollectionViewDelegate {
    private let environment: AppEnvironment
    private var books: [LibraryBook] = []

    private let titleLabel = UILabel(font: Typography.font(30, .bold, relativeTo: .largeTitle), color: Palette.ink)
    private let settingsButton = UIButton(type: .system)
    private let emptyView = ShelfEmptyView()
    private lazy var collectionView = UICollectionView(frame: .zero, collectionViewLayout: Self.layout())
    private lazy var dataSource = makeDataSource()

    init(environment: AppEnvironment) {
        self.environment = environment
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.page

        titleLabel.text = L10n.text("shelf.title")
        titleLabel.accessibilityTraits = .header
        settingsButton.setImage(UIImage(systemName: "gearshape", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)), for: .normal)
        settingsButton.tintColor = Palette.inkQuiet
        settingsButton.accessibilityLabel = L10n.text("shelf.settings")
        settingsButton.accessibilityIdentifier = "shelf.settings"
        settingsButton.addAction(UIAction { [weak self] _ in self?.openSettings() }, for: .primaryActionTriggered)

        collectionView.backgroundColor = .clear
        collectionView.delegate = self
        collectionView.alwaysBounceVertical = true
        collectionView.refreshControl = UIRefreshControl(frame: .zero, primaryAction: UIAction { [weak self] _ in
            self?.refreshFromCloud()
        })
        emptyView.onCheckAgain = { [weak self] in self?.refreshFromCloud() }

        view.addSubview(collectionView)
        view.addSubview(emptyView)
        view.addSubview(titleLabel)
        view.addSubview(settingsButton)
        titleLabel.snp.makeConstraints { make in
            make.top.equalTo(view.safeAreaLayoutGuide).offset(6)
            make.leading.equalToSuperview().inset(20)
        }
        settingsButton.snp.makeConstraints { make in
            make.centerY.equalTo(titleLabel)
            make.trailing.equalToSuperview().inset(12)
            make.leading.greaterThanOrEqualTo(titleLabel.snp.trailing).offset(8)
            make.size.equalTo(44)
        }
        collectionView.snp.makeConstraints { make in
            make.top.equalTo(titleLabel.snp.bottom).offset(10)
            make.leading.trailing.bottom.equalToSuperview()
        }
        emptyView.snp.makeConstraints { $0.edges.equalTo(collectionView) }

        NotificationCenter.default.addObserver(
            self, selector: #selector(libraryDidChange), name: .cairnLibraryDidChange, object: nil)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reload()
    }

    private var openedAtLaunch = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !openedAtLaunch, let id = environment.options.openBook else { return }
        openedAtLaunch = true
        if let book = books.first(where: { $0.id == id }) { open(book) }
    }

    // MARK: Content

    @objc private func libraryDidChange() { reload() }

    private func reload() {
        books = environment.library.books()
        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        snapshot.appendItems(books.map(\.id))
        snapshot.reconfigureItems(books.map(\.id))
        dataSource.apply(snapshot, animatingDifferences: false)

        emptyView.isHidden = !books.isEmpty
        collectionView.isHidden = books.isEmpty
        if books.isEmpty {
            Task { emptyView.show(account: await environment.cloud.account()) }
        }
    }

    private func refreshFromCloud() {
        Task {
            await environment.refreshFromCloud()
            collectionView.refreshControl?.endRefreshing()
            reload()
        }
    }

    private func makeDataSource() -> UICollectionViewDiffableDataSource<Int, String> {
        let registration = UICollectionView.CellRegistration<BookCardCell, String> { [weak self] cell, _, id in
            guard let book = self?.books.first(where: { $0.id == id }) else { return }
            cell.show(book)
        }
        return UICollectionViewDiffableDataSource(collectionView: collectionView) { collectionView, indexPath, id in
            collectionView.dequeueConfiguredReusableCell(using: registration, for: indexPath, item: id)
        }
    }

    private static func layout() -> UICollectionViewLayout {
        let size = NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(BookCardCell.height))
        let group = NSCollectionLayoutGroup.vertical(layoutSize: size, subitems: [NSCollectionLayoutItem(layoutSize: size)])
        let section = NSCollectionLayoutSection(group: group)
        section.interGroupSpacing = 12
        section.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 16, bottom: 40, trailing: 16)
        return UICollectionViewCompositionalLayout(section: section)
    }

    // MARK: Opening

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: false)
        guard let book = books[safe: indexPath.item] else { return }
        open(book)
    }

    func collectionView(_ collectionView: UICollectionView, shouldSelectItemAt indexPath: IndexPath) -> Bool {
        books[safe: indexPath.item]?.canOpen == true
    }

    // MARK: Removing

    /// Touch and hold a book that came from iCloud. The built-in one is part of the app and has no menu.
    func collectionView(
        _ collectionView: UICollectionView, contextMenuConfigurationForItemsAt indexPaths: [IndexPath], point: CGPoint
    ) -> UIContextMenuConfiguration? {
        guard let index = indexPaths.first?.item, let book = books[safe: index],
              environment.library.isSynced(book.id)
        else { return nil }
        return UIContextMenuConfiguration(actionProvider: { [weak self] _ in
            UIMenu(children: [
                UIAction(
                    title: L10n.text("shelf.remove"), image: UIImage(systemName: "icloud.slash"), attributes: .destructive
                ) { _ in self?.confirmRemoval(of: book) },
            ])
        })
    }

    private func confirmRemoval(of book: LibraryBook) {
        let size = L10n.bytes(environment.library.bytesUsed(by: book.id))
        let alert = UIAlertController(
            title: L10n.format("shelf.remove.title", ShelfText.title(book)),
            message: L10n.format("shelf.remove.message", size), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: L10n.text("shelf.remove.cancel"), style: .cancel))
        alert.addAction(UIAlertAction(title: L10n.text("shelf.remove.confirm"), style: .destructive) { [weak self] _ in
            self?.remove(book)
        })
        present(alert, animated: true)
    }

    private func remove(_ book: LibraryBook) {
        Task {
            do {
                try await environment.removeFromCloud(book.id)
                reload()
            } catch {
                let alert = UIAlertController(
                    title: L10n.text("shelf.remove.failed"), message: L10n.text("shelf.remove.failed.message"),
                    preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: L10n.text("shelf.remove.ok"), style: .default))
                present(alert, animated: true)
            }
        }
    }

    private func open(_ book: LibraryBook) {
        guard let player = environment.makePlayer(for: book) else { return }
        navigationController?.pushViewController(player, animated: true)
    }

    private func openSettings() {
        present(environment.makeSettings(), animated: true)
    }
}

extension Notification.Name {
    /// Posted on the main queue whenever a book on disk, or a reader's place in one, has changed.
    static let cairnLibraryDidChange = Notification.Name("dev.jasper.cairn.libraryDidChange")
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
