import UIKit

/// Lets the screen on top answer for itself: the shelf stays upright, the player turns.
final class RootNavigationController: UINavigationController, UIGestureRecognizerDelegate {
    override func viewDidLoad() {
        super.viewDidLoad()
        setNavigationBarHidden(true, animated: false)
        // UIKit's own delegate refuses the edge swipe whenever the bar is hidden.
        interactivePopGestureRecognizer?.delegate = self
    }

    /// Full screen is the player turned sideways, where back means upright again, not the shelf.
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1 && view.bounds.width < view.bounds.height
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        topViewController?.supportedInterfaceOrientations ?? .portrait
    }

    override var childForStatusBarHidden: UIViewController? { topViewController }
    override var childForStatusBarStyle: UIViewController? { topViewController }
    override var childForHomeIndicatorAutoHidden: UIViewController? { topViewController }
}
