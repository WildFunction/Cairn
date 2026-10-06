import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    private(set) lazy var environment = AppEnvironment()

    func application(
        _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // CloudKit's silent pushes wake the sync engine; nothing is ever shown to the reader.
        if environment.isCloudEnabled { application.registerForRemoteNotifications() }
        Task { await environment.refreshFromCloud() }
        return true
    }

    func application(
        _ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        await environment.refreshFromCloud()
        return .newData
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    }
}
