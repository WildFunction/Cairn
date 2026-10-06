import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene,
              let environment = (UIApplication.shared.delegate as? AppDelegate)?.environment
        else { return }
        let window = UIWindow(windowScene: windowScene)
        window.tintColor = Palette.accent
        window.rootViewController = RootNavigationController(
            rootViewController: ShelfViewController(environment: environment))
        window.makeKeyAndVisible()
        self.window = window
    }

    /// Every screen is built from the strings of one language, so a new language is a new set of screens.
    /// Settings is put back on top: that is where the reader was standing when they chose.
    func languageDidChange() {
        guard let window, let environment = (UIApplication.shared.delegate as? AppDelegate)?.environment else { return }
        let root = RootNavigationController(rootViewController: ShelfViewController(environment: environment))
        window.rootViewController = root
        DispatchQueue.main.async { root.present(environment.makeSettings(), animated: false) }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        guard let environment = (UIApplication.shared.delegate as? AppDelegate)?.environment else { return }
        Task { await environment.refreshFromCloud() }
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        (UIApplication.shared.delegate as? AppDelegate)?.environment.didEnterBackground()
    }
}
