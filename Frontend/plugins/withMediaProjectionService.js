const fs = require('fs');
const path = require('path');
const { withMainApplication, withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

module.exports = function withMediaProjectionService(config) {
    config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.POST_NOTIFICATIONS']);
    config = withAndroidManifest(config, config => {
        const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
        const name = 'com.oney.WebRTCModule.NagomiScreenShareControlsModule$StopReceiver';
        app.receiver = app.receiver || [];
        if (!app.receiver.some(receiver => receiver.$?.['android:name'] === name)) {
            app.receiver.push({ $: { 'android:name': name, 'android:exported': 'false' } });
        }
        return config;
    });
    config = withMainApplication(config, config => {
        const application = config.modResults;
        const setting = 'com.oney.WebRTCModule.WebRTCModuleOptions.getInstance().enableMediaProjectionService = true';
        if (!application.contents.includes(setting)) {
            const anchor = /super\.onCreate\(\);?/;
            if (!anchor.test(application.contents)) throw new Error('Không tìm thấy super.onCreate trong MainApplication.');
            const statement = application.language === 'java' ? setting + ';' : setting;
            application.contents = application.contents.replace(anchor, match => match + '\n    ' + statement);
        }
        const pkg = 'com.oney.WebRTCModule.NagomiScreenShareControlsModule.Package';
        if (!application.contents.includes(pkg)) {
            if (application.language === 'kt') {
                const anchor = /PackageList\(this\)\.packages\.apply\s*\{/;
                if (!anchor.test(application.contents)) throw new Error('Không tìm thấy danh sách package Kotlin.');
                application.contents = application.contents.replace(anchor, match => match + '\n            add(' + pkg + '())');
            } else {
                const anchor = /(?:List|ArrayList)<ReactPackage>\s+packages\s*=\s*new PackageList\(this\)\.getPackages\(\);/;
                if (!anchor.test(application.contents)) throw new Error('Không tìm thấy danh sách package Java.');
                application.contents = application.contents.replace(anchor, match => match + '\n      packages.add(new ' + pkg + '());');
            }
        }
        return config;
    });
    return withDangerousMod(config, ['android', async config => {
        const target = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java/com/oney/WebRTCModule');
        fs.mkdirSync(target, { recursive: true });
        fs.copyFileSync(path.join(__dirname, 'android-screen-share/NagomiScreenShareControlsModule.java'),
            path.join(target, 'NagomiScreenShareControlsModule.java'));
        fs.copyFileSync(path.join(__dirname, 'android-screen-share/NagomiPlaybackAudioModule.java'),
            path.join(target, 'NagomiPlaybackAudioModule.java'));
        // WebRTC dùng tên resource này khi tạo thông báo foreground đầu tiên.
        const drawable = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
        fs.mkdirSync(drawable, { recursive: true });
        fs.copyFileSync(path.join(__dirname, 'android-screen-share/ic_notification.xml'),
            path.join(drawable, 'ic_notification.xml'));
        return config;
    }]);
};
