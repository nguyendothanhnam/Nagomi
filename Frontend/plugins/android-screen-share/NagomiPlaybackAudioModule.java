package com.oney.WebRTCModule;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.Base64;
import android.util.DisplayMetrics;
import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.util.concurrent.ArrayBlockingQueue;
import org.webrtc.MediaStreamTrack;
import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.VideoTrack;

// PCM riêng cho tiếng app; không thay thế hay trộn vào micro cuộc gọi.
public class NagomiPlaybackAudioModule extends ReactContextBaseJavaModule {
    private static final int REQUEST = 64821, RATE = 48000, CHUNK = 1920;
    private Promise pending;
    private String pendingSession;
    private volatile Capture capture;
    private Playback playback;

    public NagomiPlaybackAudioModule(ReactApplicationContext context) {
        super(context);
        context.addActivityEventListener(new BaseActivityEventListener() {
            @Override public void onActivityResult(Activity activity, int request, int result, Intent data) {
                if (request != REQUEST) return;
                final Promise promise;
                final String session;
                synchronized (NagomiPlaybackAudioModule.this) {
                    promise = pending; session = pendingSession; pending = null; pendingSession = null;
                }
                if (promise == null) return;
                if (result != Activity.RESULT_OK || data == null) { promise.reject("CAPTURE_CANCELLED", "Đã hủy chia sẻ màn hình."); return; }
                ThreadUtils.runOnExecutor(() -> createCapture(activity, data, session, promise));
            }
        });
    }
    @Override public String getName() { return "NagomiPlaybackAudio"; }

    @ReactMethod public synchronized void getDisplayMedia(String session, Promise promise) {
        Activity activity = getReactApplicationContext().getCurrentActivity();
        if (activity == null || pending != null) { promise.reject("CAPTURE_BUSY", "Chưa mở được hộp chia sẻ màn hình."); return; }
        pending = promise; pendingSession = session;
        activity.runOnUiThread(() -> {
            try {
                MediaProjectionManager manager = (MediaProjectionManager) activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                activity.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST);
            } catch (Exception error) {
                synchronized (NagomiPlaybackAudioModule.this) { pending = null; pendingSession = null; }
                promise.reject("CAPTURE_PERMISSION", error);
            }
        });
    }

    private void createCapture(Activity activity, Intent data, String session, Promise promise) {
        WebRTCModule rtc = getReactApplicationContext().getNativeModule(WebRTCModule.class);
        VideoTrack track = null;
        try {
            if (rtc == null) throw new IllegalStateException("Chưa khởi tạo WebRTC.");
            MediaProjectionService.launch(activity);
            DisplayMetrics metrics = DisplayUtils.getDisplayMetrics(activity);
            ScreenCaptureController controller = new ScreenCaptureController(activity, metrics.widthPixels, metrics.heightPixels, data) {
                @Override public void dispose() { NagomiPlaybackAudioModule.this.stopCapture(session); super.dispose(); }
            };
            track = rtc.createVideoTrack(controller);
            if (track == null) throw new IllegalStateException("Không tạo được track màn hình.");
            String audioError = null;
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    MediaProjection projection = ((ScreenCapturerAndroid) controller.videoCapturer).getMediaProjection();
                    AudioPlaybackCaptureConfiguration config = new AudioPlaybackCaptureConfiguration.Builder(projection)
                        .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME)
                        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).excludeUid(android.os.Process.myUid()).build();
                    AudioFormat format = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
                    int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    AudioRecord record = new AudioRecord.Builder().setAudioFormat(format)
                        .setBufferSizeInBytes(Math.max(minimum, CHUNK * 6)).setAudioPlaybackCaptureConfig(config).build();
                    if (record.getState() != AudioRecord.STATE_INITIALIZED) { record.release(); throw new IllegalStateException("Không mở được AudioPlaybackCapture."); }
                    Capture next = new Capture(session, record);
                    Capture old = capture; if (old != null) old.finish();
                    capture = next;
                    next.start();
                } catch (Exception error) { audioError = "Không thu được tiếng app: " + error.getMessage(); }
            } else audioError = "Thu tiếng app cần Android 10 trở lên.";
            final String warning = audioError;
            rtc.createStream(new MediaStreamTrack[]{track}, (id, tracks) -> {
                WritableMap result = Arguments.createMap();
                result.putString("streamId", id); result.putMap("track", tracks.get(0));
                result.putBoolean("audioAvailable", warning == null);
                if (warning != null) result.putString("audioError", warning);
                promise.resolve(result);
            });
        } catch (Exception error) {
            stopCapture(session);
            if (rtc != null && track != null) rtc.mediaStreamTrackRelease(track.id());
            MediaProjectionService.abort(activity);
            promise.reject("CAPTURE_START", error);
        }
    }

    private class Capture extends Thread {
        final String session; final AudioRecord record; volatile boolean running = true;
        Capture(String session, AudioRecord record) { super("NagomiPlaybackCapture"); this.session = session; this.record = record; }
        void stopCapture() { running = false; try { record.stop(); } catch (Exception ignored) { } }
        // Thread.stop không được dùng; dừng bằng cờ và AudioRecord.stop.
        void finish() { stopCapture(); }
        @Override public void run() {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
            try {
                record.startRecording();
                byte[] pcm = new byte[CHUNK]; int offset = 0, sequence = 0;
                while (running) {
                    int size = record.read(pcm, offset, pcm.length - offset);
                    if (size <= 0) break;
                    offset += size; if (offset != pcm.length) continue; offset = 0;
                    WritableMap event = Arguments.createMap(); event.putString("sessionId", session);
                    event.putInt("sequence", sequence++); event.putString("data", Base64.encodeToString(pcm, Base64.NO_WRAP));
                    if (running && getReactApplicationContext().hasActiveReactInstance()) getReactApplicationContext()
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("NagomiScreenAudio", event);
                }
            } catch (Exception error) {
                android.util.Log.w("NagomiPlaybackAudio", "Capture ended: " + error.getMessage());
                if (running && getReactApplicationContext().hasActiveReactInstance()) {
                    WritableMap event = Arguments.createMap(); event.putString("sessionId", session);
                    event.putString("message", "Không thu được âm thanh app: " + error.getMessage());
                    getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("NagomiScreenAudioError", event);
                }
            } finally { try { record.stop(); } catch (Exception ignored) { } record.release(); }
        }
    }

    @ReactMethod public synchronized void stopCapture(String session) {
        Capture current = capture;
        if (current != null && current.session.equals(session)) { capture = null; current.finish(); }
    }

    @ReactMethod public synchronized void playChunk(String session, String data) {
        if (data == null || data.length() > 2560) return;
        if (playback == null || !playback.session.equals(session)) {
            if (playback != null) playback.finish();
            playback = new Playback(session); playback.start();
        }
        try {
            byte[] pcm = Base64.decode(data, Base64.NO_WRAP);
            if (pcm.length != CHUNK) return;
            if (!playback.queue.offer(pcm)) { playback.queue.poll(); playback.queue.offer(pcm); }
        } catch (IllegalArgumentException ignored) { }
    }
    @ReactMethod public synchronized void stopPlayback(String session) {
        if (playback != null && (session == null || playback.session.equals(session))) { playback.finish(); playback = null; }
    }
    private static class Playback extends Thread {
        final String session; final ArrayBlockingQueue<byte[]> queue = new ArrayBlockingQueue<>(6); volatile boolean running = true;
        Playback(String session) { super("NagomiPlaybackOutput"); this.session = session; }
        void finish() { running = false; queue.clear(); interrupt(); }
        @Override public void run() {
            AudioTrack output = null;
            try {
                output = new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(Math.max(CHUNK * 6, AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)))
                    .setTransferMode(AudioTrack.MODE_STREAM).build();
                output.play();
                while (running) { byte[] pcm = queue.take(); if (running) output.write(pcm, 0, pcm.length); }
            } catch (Exception error) { android.util.Log.d("NagomiPlaybackAudio", "Playback stopped: " + error.getMessage()); }
            finally { if (output != null) { try { output.stop(); } catch (Exception ignored) { } output.release(); } }
        }
    }
    @Override public void invalidate() {
        Capture current = capture; if (current != null) current.finish();
        if (playback != null) playback.finish();
        synchronized (this) { if (pending != null) pending.reject("CAPTURE_CLOSED", "Phiên chia sẻ đã đóng."); pending = null; }
        super.invalidate();
    }
}
