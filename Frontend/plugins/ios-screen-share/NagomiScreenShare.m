#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface NagomiScreenShare : NSObject <RCTBridgeModule>
@end

@implementation NagomiScreenShare
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSUserDefaults *)sharedDefaults {
    NSString *group = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"RTCAppGroupIdentifier"];
    if (!group || ![[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:group]) return nil;
    return [[NSUserDefaults alloc] initWithSuiteName:group];
}

RCT_EXPORT_METHOD(prepare:(NSString *)session resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSUserDefaults *defaults = [self sharedDefaults];
    if (!defaults) { reject(@"missing_app_group", @"Build iOS chua co App Group chia se man hinh.", nil); return; }
    [defaults setObject:session forKey:@"NagomiBroadcastSession"];
    [defaults setObject:@"waiting" forKey:@"NagomiBroadcastState"];
    [defaults synchronize];
    resolve(@YES);
}

RCT_EXPORT_METHOD(status:(NSString *)session resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSUserDefaults *defaults = [self sharedDefaults];
    [defaults synchronize];
    if (![[defaults stringForKey:@"NagomiBroadcastSession"] isEqualToString:session]) { resolve(@"stopped"); return; }
    resolve([defaults stringForKey:@"NagomiBroadcastState"] ?: @"stopped");
}

RCT_EXPORT_METHOD(stop:(NSString *)session resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSUserDefaults *defaults = [self sharedDefaults];
    if ([[defaults stringForKey:@"NagomiBroadcastSession"] isEqualToString:session]) {
        [defaults setObject:@"stopping" forKey:@"NagomiBroadcastState"];
        [defaults synchronize];
    }
    resolve(@YES);
}
@end
