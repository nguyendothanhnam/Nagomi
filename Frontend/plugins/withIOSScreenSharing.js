const fs = require('fs');
const path = require('path');
const { withInfoPlist, withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');
const plist = require('@expo/plist').default;

module.exports = function withIOSScreenSharing(config) {
    const targetName = 'NagomiBroadcastUpload';
    const bundleId = config.ios?.bundleIdentifier || config.android?.package || 'com.anonymous.nagomi';
    const groupId = 'group.' + bundleId;
    const extensionId = bundleId + '.ScreenBroadcast';
    config.ios = { ...config.ios, bundleIdentifier: bundleId };
    config.extra = config.extra || {};
    config.extra.eas = config.extra.eas || {};
    const build = config.extra.eas.build = config.extra.eas.build || {};
    const experimental = build.experimental = build.experimental || {};
    const ios = experimental.ios = experimental.ios || {};
    ios.appExtensions = [...(ios.appExtensions || []).filter(item => item.targetName !== targetName), {
        targetName, bundleIdentifier: extensionId,
        entitlements: { 'com.apple.security.application-groups': [groupId] },
    }];
    config = withInfoPlist(config, config => {
        config.modResults.RTCAppGroupIdentifier = groupId;
        config.modResults.RTCScreenSharingExtension = extensionId;
        config.modResults.UIBackgroundModes = [...new Set([...(config.modResults.UIBackgroundModes || []), 'audio'])];
        return config;
    });
    config = withEntitlementsPlist(config, config => {
        const key = 'com.apple.security.application-groups';
        config.modResults[key] = [...new Set([...(config.modResults[key] || []), groupId])];
        return config;
    });
    return withXcodeProject(config, config => {
        const project = config.modResults;
        const iosRoot = config.modRequest.platformProjectRoot;
        const extensionRoot = path.join(iosRoot, targetName);
        const bridgeName = 'NagomiScreenShare';
        const bridgeRoot = path.join(iosRoot, bridgeName);
        fs.mkdirSync(extensionRoot, { recursive: true });
        fs.mkdirSync(bridgeRoot, { recursive: true });
        fs.copyFileSync(path.join(__dirname, 'ios-screen-share', 'SampleHandler.m'), path.join(extensionRoot, 'SampleHandler.m'));
        fs.copyFileSync(path.join(__dirname, 'ios-screen-share', 'NagomiScreenShare.m'), path.join(bridgeRoot, 'NagomiScreenShare.m'));
        fs.writeFileSync(path.join(extensionRoot, 'Info.plist'), plist.build({
            CFBundleDisplayName: 'Nagomi Screen Share', CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
            CFBundleExecutable: '$(EXECUTABLE_NAME)', CFBundleName: '$(PRODUCT_NAME)',
            CFBundlePackageType: 'XPC!', CFBundleInfoDictionaryVersion: '6.0', CFBundleShortVersionString: config.version || '1.0.0',
            CFBundleVersion: '$(CURRENT_PROJECT_VERSION)', RTCAppGroupIdentifier: groupId,
            NSExtension: { NSExtensionPointIdentifier: 'com.apple.broadcast-services-upload',
                NSExtensionPrincipalClass: 'SampleHandler',
                NSExtensionAttributes: { RPBroadcastProcessMode: 'RPBroadcastProcessModeSampleBuffer' } },
        }));
        fs.writeFileSync(path.join(extensionRoot, targetName + '.entitlements'), plist.build({ 'com.apple.security.application-groups': [groupId] }));
        const objects = project.hash.project.objects;
        const main = project.getFirstTarget();
        let extension = Object.entries(objects.PBXNativeTarget).find(([id, item]) => !id.endsWith('_comment') && String(item.name).replace(/"/g, '') === targetName);
        let targetId;
        if (extension) targetId = extension[0];
        else {
            const target = project.addTarget(targetName, 'app_extension', targetName, extensionId);
            targetId = target.uuid;
            project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetId);
            project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetId);
            project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetId);
        }
        const mainGroupId = project.getFirstProject().firstProject.mainGroup;
        function group(name) {
            const existing = Object.entries(objects.PBXGroup).find(([id, item]) => !id.endsWith('_comment') && item.name === name);
            if (existing) return existing[0];
            const added = project.addPbxGroup([], name);
            project.addToPbxGroup(added.uuid, mainGroupId);
            return added.uuid;
        }
        const extensionGroup = group(targetName);
        const bridgeGroup = group(bridgeName);
        // Nhóm ảo ở gốc project; đường dẫn nguồn đầy đủ tránh trùng tên extension khác.
        if (!project.pbxGroupByName(targetName).children.some(item => item.comment === 'SampleHandler.m')) {
            project.addSourceFile(targetName + '/SampleHandler.m', { target: targetId }, extensionGroup);
        }
        if (!project.pbxGroupByName(bridgeName).children.some(item => item.comment === 'NagomiScreenShare.m')) {
            project.addSourceFile(bridgeName + '/NagomiScreenShare.m', { target: main.uuid }, bridgeGroup);
        }
        for (const framework of ['ReplayKit', 'CoreImage', 'ImageIO', 'CoreMedia', 'CoreVideo', 'Foundation']) {
            const phase = objects.PBXNativeTarget[targetId].buildPhases.find(item => item.comment === 'Frameworks');
            const refs = objects.PBXFrameworksBuildPhase[phase.value].files;
            const name = framework + '.framework';
            if (!refs.some(item => item.comment === name + ' in Frameworks')) {
                const existing = Object.entries(objects.PBXFileReference).find(([id, item]) => !id.endsWith('_comment') && String(item.path).replace(/"/g, '').endsWith(name));
                if (existing) {
                    const uuid = project.generateUuid();
                    objects.PBXBuildFile[uuid] = { isa: 'PBXBuildFile', fileRef: existing[0], fileRef_comment: name };
                    objects.PBXBuildFile[uuid + '_comment'] = name + ' in Frameworks';
                    refs.push({ value: uuid, comment: name + ' in Frameworks' });
                } else project.addFramework(name, { target: targetId });
            }
        }
        const mainConfigIds = objects.XCConfigurationList[main.firstTarget.buildConfigurationList].buildConfigurations.map(item => item.value);
        const mainSettings = objects.XCBuildConfiguration[mainConfigIds[0]].buildSettings;
        const configIds = objects.XCConfigurationList[objects.PBXNativeTarget[targetId].buildConfigurationList].buildConfigurations.map(item => item.value);
        for (const id of configIds) {
            Object.assign(objects.XCBuildConfiguration[id].buildSettings, {
                PRODUCT_BUNDLE_IDENTIFIER: '"' + extensionId + '"',
                INFOPLIST_FILE: '"' + targetName + '/Info.plist"',
                CODE_SIGN_ENTITLEMENTS: '"' + targetName + '/' + targetName + '.entitlements"',
                APPLICATION_EXTENSION_API_ONLY: 'YES', CLANG_ENABLE_OBJC_ARC: 'YES',
                CODE_SIGN_STYLE: 'Automatic', SDKROOT: 'iphoneos', TARGETED_DEVICE_FAMILY: '"1,2"',
                IPHONEOS_DEPLOYMENT_TARGET: mainSettings.IPHONEOS_DEPLOYMENT_TARGET || '15.1',
                CURRENT_PROJECT_VERSION: mainSettings.CURRENT_PROJECT_VERSION || '1',
                MARKETING_VERSION: '"' + (config.version || '1.0.0') + '"', SKIP_INSTALL: 'YES',
            });
            const team = mainSettings.DEVELOPMENT_TEAM || config.ios?.appleTeamId;
            if (team) objects.XCBuildConfiguration[id].buildSettings.DEVELOPMENT_TEAM = team;
        }
        return config;
    });
};
