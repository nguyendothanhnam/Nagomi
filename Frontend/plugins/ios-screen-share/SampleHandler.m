#import <ReplayKit/ReplayKit.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>
#import <sys/socket.h>
#import <sys/un.h>
#import <sys/time.h>
#import <string.h>
#import <unistd.h>
#import <errno.h>
#import <math.h>

@interface SampleHandler : RPBroadcastSampleHandler
@property(nonatomic) int connection;
@property(nonatomic) BOOL finishing;
@property(nonatomic) double lastFrameTime;
@property(nonatomic, strong) CIContext *imageContext;
@property(nonatomic, strong) NSUserDefaults *defaults;
@property(nonatomic, copy) NSString *session;
@property(nonatomic, strong) dispatch_source_t stopMonitor;
@end

@implementation SampleHandler
- (void)setBroadcastState:(NSString *)state {
    if ([[self.defaults stringForKey:@"NagomiBroadcastSession"] isEqualToString:self.session]) {
        [self.defaults setObject:state forKey:@"NagomiBroadcastState"];
        [self.defaults synchronize];
    }
}

- (void)terminate:(NSString *)reason {
    @synchronized(self) {
        if (self.finishing) return;
        self.finishing = YES;
        if (self.connection >= 0) { shutdown(self.connection, SHUT_RDWR); close(self.connection); self.connection = -1; }
        [self setBroadcastState:@"stopped"];
        if (self.stopMonitor) { dispatch_source_cancel(self.stopMonitor); self.stopMonitor = nil; }
        NSError *error = [NSError errorWithDomain:@"NagomiScreenShare" code:1 userInfo:@{NSLocalizedDescriptionKey:reason}];
        [self finishBroadcastWithError:error];
    }
}

- (void)broadcastStartedWithSetupInfo:(NSDictionary<NSString *, NSObject *> *)setupInfo {
    self.connection = -1;
    self.finishing = NO;
    self.lastFrameTime = -1;
    NSString *group = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"RTCAppGroupIdentifier"];
    NSURL *container = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:group];
    if (!container) { [self terminate:@"Nagomi: App Group chua duoc cau hinh."]; return; }
    self.defaults = [[NSUserDefaults alloc] initWithSuiteName:group];
    [self.defaults synchronize];
    self.session = [self.defaults stringForKey:@"NagomiBroadcastSession"];
    if (!self.session || ![[self.defaults stringForKey:@"NagomiBroadcastState"] isEqualToString:@"waiting"]) {
        [self terminate:@"Hay bat chia se tu kenh thoai Nagomi."]; return;
    }
    NSString *file = [[container URLByAppendingPathComponent:@"rtc_SSFD"] path];
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    address.sun_len = sizeof(address);
    const char *socketPath = file.fileSystemRepresentation;
    if (strlen(socketPath) >= sizeof(address.sun_path)) { [self terminate:@"Duong dan socket qua dai."]; return; }
    strlcpy(address.sun_path, socketPath, sizeof(address.sun_path));
    self.connection = socket(AF_UNIX, SOCK_STREAM, 0);
    if (self.connection < 0) { [self terminate:@"Khong tao duoc socket."]; return; }
    int noSignal = 1;
    setsockopt(self.connection, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, sizeof(noSignal));
    struct timeval timeout = {0, 200000};
    setsockopt(self.connection, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    if (connect(self.connection, (struct sockaddr *)&address, sizeof(address)) != 0) {
        [self terminate:@"Khong ket noi duoc Nagomi. Hay vao lai kenh thoai."]; return;
    }
    self.imageContext = [CIContext contextWithOptions:@{kCIContextCacheIntermediates:@NO}];
    [self setBroadcastState:@"active"];
    self.stopMonitor = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(self.stopMonitor, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_MSEC * 500), NSEC_PER_MSEC * 500, NSEC_PER_MSEC * 100);
    __weak SampleHandler *weakSelf = self;
    dispatch_source_set_event_handler(self.stopMonitor, ^{
        SampleHandler *strongSelf = weakSelf;
        if (!strongSelf) return;
        [strongSelf.defaults synchronize];
        if (![[strongSelf.defaults stringForKey:@"NagomiBroadcastSession"] isEqualToString:strongSelf.session]
            || [[strongSelf.defaults stringForKey:@"NagomiBroadcastState"] isEqualToString:@"stopping"]) {
            [strongSelf terminate:@"Da dung chia se man hinh."];
        }
    });
    dispatch_resume(self.stopMonitor);
}

- (void)processSampleBuffer:(CMSampleBufferRef)sampleBuffer withType:(RPSampleBufferType)sampleBufferType {
    if (sampleBufferType != RPSampleBufferTypeVideo) return;
    @synchronized(self) {
        if (self.finishing || self.connection < 0) return;
        double time = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer));
        if (!isfinite(time) || (self.lastFrameTime >= 0 && time - self.lastFrameTime < 1.0 / 12.0)) return;
        self.lastFrameTime = time;
        @autoreleasepool {
            CVPixelBufferRef buffer = CMSampleBufferGetImageBuffer(sampleBuffer);
            if (!buffer) return;
            CIImage *image = [CIImage imageWithCVPixelBuffer:buffer];
            CGFloat scale = MIN(1.0, 960.0 / MAX(image.extent.size.width, image.extent.size.height));
            image = [image imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
            size_t width = (size_t)floor(image.extent.size.width), height = (size_t)floor(image.extent.size.height);
            CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
            NSData *jpeg = [self.imageContext JPEGRepresentationOfImage:image colorSpace:color options:@{(NSString *)kCGImageDestinationLossyCompressionQuality:@0.6}];
            CGColorSpaceRelease(color);
            if (!jpeg || width == 0 || height == 0) return;
            NSNumber *orientation = (__bridge NSNumber *)CMGetAttachment(sampleBuffer, RPVideoSampleOrientationKey, NULL);
            NSString *header = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Length: %lu\r\nBuffer-Width: %lu\r\nBuffer-Height: %lu\r\nBuffer-Orientation: %d\r\n\r\n", (unsigned long)jpeg.length, (unsigned long)width, (unsigned long)height, orientation ? orientation.intValue : 1];
            NSMutableData *packet = [[header dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
            [packet appendData:jpeg];
            const uint8_t *bytes = packet.bytes;
            NSUInteger sent = 0;
            while (sent < packet.length) {
                ssize_t count = send(self.connection, bytes + sent, packet.length - sent, 0);
                if (count < 0 && errno == EINTR) continue;
                if (count <= 0) { [self terminate:@"Ket noi chia se da dong."]; return; }
                sent += (NSUInteger)count;
            }
        }
    }
}

- (void)broadcastPaused { [self setBroadcastState:@"paused"]; }
- (void)broadcastResumed { self.lastFrameTime = -1; [self setBroadcastState:@"active"]; }
- (void)broadcastFinished {
    @synchronized(self) {
        self.finishing = YES;
        if (self.stopMonitor) { dispatch_source_cancel(self.stopMonitor); self.stopMonitor = nil; }
        if (self.connection >= 0) { shutdown(self.connection, SHUT_RDWR); close(self.connection); self.connection = -1; }
        [self setBroadcastState:@"stopped"];
        self.imageContext = nil;
    }
}
@end
