package com.oney.WebRTCModule;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.graphics.PixelFormat;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.NotificationCompat;
import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.uimanager.ViewManager;
import java.lang.ref.WeakReference;
import java.util.Collections;
import java.util.List;

// Cùng package với WebRTC để cập nhật đúng thông báo foreground đang có.
public class NagomiScreenShareControlsModule extends ReactContextBaseJavaModule {
    private static final String ACTION_STOP = "nagomi.screenShare.STOP";
    private static WeakReference<NagomiScreenShareControlsModule> active = new WeakReference<>(null);
    private String trackId;
    private String sessionId;
    private String stoppedSessionId;
    private View overlay;
    private final Handler ui = new Handler(Looper.getMainLooper());

    public NagomiScreenShareControlsModule(ReactApplicationContext context) {
        super(context);
        active = new WeakReference<>(this);
    }

    @Override public String getName() { return "NagomiScreenShareControls"; }

    @ReactMethod public synchronized void show(String track, String session, Promise promise) {
        try {
            trackId = track;
            sessionId = session;
            stoppedSessionId = null;
            Context context = getReactApplicationContext();
            MediaProjectionNotification.createNotificationChannel(context);
            Intent intent = new Intent(context, StopReceiver.class)
                .setAction(ACTION_STOP)
                .setData(Uri.parse("nagomi://screen-share/" + Uri.encode(session)))
                .putExtra("sessionId", session);
            PendingIntent stop = PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            int icon = context.getResources().getIdentifier("ic_notification", "drawable", context.getPackageName());
            if (icon == 0) icon = context.getApplicationInfo().icon;
            NotificationCompat.Builder notification = new NotificationCompat.Builder(context,
                MediaProjectionNotification.ONGOING_CONFERENCE_CHANNEL_ID)
                .setSmallIcon(icon)
                .setContentTitle("Nagomi đang chia sẻ màn hình")
                .setContentText("Bạn có thể dừng chia sẻ ngay tại đây.")
                .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .addAction(android.R.drawable.ic_media_pause, "Dừng chia sẻ", stop);
            ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
                .notify(MediaProjectionService.NOTIFICATION_ID, notification.build());
            ui.post(() -> showOverlay(session));
            promise.resolve(null);
        } catch (Exception error) {
            promise.reject("SCREEN_SHARE_NOTIFICATION", error);
        }
    }

    // Không cho nút của phiên cũ dừng nhầm phiên đang chạy.
    private synchronized void stopFromNotification(String session) {
        if (session == null || !session.equals(sessionId) || trackId == null) return;
        String capturedTrack = trackId;
        stoppedSessionId = session;
        trackId = null;
        sessionId = null;
        WebRTCModule rtc = getReactApplicationContext().getNativeModule(WebRTCModule.class);
        if (rtc != null) {
            rtc.mediaStreamTrackSetEnabled(-1, capturedTrack, false);
            rtc.mediaStreamTrackRelease(capturedTrack);
        }
        cancelNotification();
        // Native đã dừng capture; JS chỉ dọn sender và thông báo cho kênh.
        if (getReactApplicationContext().hasActiveReactInstance()) {
            WritableMap payload = Arguments.createMap();
            payload.putString("sessionId", session);
            getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("NagomiScreenShareStopped", payload);
        }
    }

    @ReactMethod public synchronized void clear(String session) {
        if (session == null || !session.equals(sessionId)) return;
        trackId = null;
        sessionId = null;
        cancelNotification();
    }

    @ReactMethod public synchronized void getStoppedSession(Promise promise) {
        promise.resolve(stoppedSessionId);
    }

    @ReactMethod public void hasOverlayPermission(Promise promise) {
        promise.resolve(Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(getReactApplicationContext()));
    }
    @ReactMethod public void requestOverlayPermission(Promise promise) {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getReactApplicationContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            promise.resolve(null);
        } catch (Exception error) { promise.reject("OVERLAY_PERMISSION", error); }
    }
    private int dp(float value) { return Math.round(value * getReactApplicationContext().getResources().getDisplayMetrics().density); }
    private TextView label(String text, int color) {
        TextView view = new TextView(getReactApplicationContext()); view.setText(text);
        view.setTextColor(color); view.setTextSize(12); view.setPadding(dp(8), dp(10), dp(8), dp(10)); return view;
    }
    private void removeOverlay() {
        if (overlay == null) return;
        try { ((WindowManager) getReactApplicationContext().getSystemService(Context.WINDOW_SERVICE)).removeView(overlay); }
        catch (Exception ignored) { } overlay = null;
    }
    private synchronized void showOverlay(String session) {
        if (!session.equals(sessionId) || !Settings.canDrawOverlays(getReactApplicationContext())) return;
        removeOverlay();
        Context context = getReactApplicationContext();
        LinearLayout bar = new LinearLayout(context); bar.setOrientation(LinearLayout.HORIZONTAL); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(4), dp(4), dp(4), dp(4));
        GradientDrawable background = new GradientDrawable(); background.setColor(Color.rgb(32,33,36)); background.setCornerRadius(dp(12)); bar.setBackground(background);
        TextView title = label("Nagomi đang chia sẻ", Color.WHITE); title.setSingleLine(true); title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        TextView stop = label("Dừng chia sẻ", Color.WHITE); stop.setTypeface(null, Typeface.BOLD);
        GradientDrawable blue = new GradientDrawable(); blue.setColor(Color.rgb(64,105,220)); blue.setCornerRadius(dp(16)); stop.setBackground(blue);
        stop.setOnClickListener(view -> stopFromNotification(session)); bar.addView(stop);
        TextView hide = label("Ẩn", Color.LTGRAY); hide.setOnClickListener(view -> removeOverlay()); bar.addView(hide);
        WindowManager manager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            Math.min(context.getResources().getDisplayMetrics().widthPixels - dp(16), dp(430)), -2,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL; params.y = dp(56);
        title.setOnTouchListener(new View.OnTouchListener() {
            float x, y; int initialX, initialY;
            @Override public boolean onTouch(View view, MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_DOWN) { x=event.getRawX(); y=event.getRawY(); initialX=params.x; initialY=params.y; return true; }
                if (event.getAction() == MotionEvent.ACTION_MOVE) { params.x=initialX+(int)(event.getRawX()-x); params.y=Math.max(0,initialY+(int)(event.getRawY()-y)); try { manager.updateViewLayout(bar,params); } catch (Exception ignored) { } return true; }
                return true;
            }
        });
        try { manager.addView(bar, params); overlay = bar; }
        catch (Exception error) { android.util.Log.w("NagomiScreenShare", "Overlay: " + error.getMessage()); }
    }
    private void cancelNotification() {
        ui.post(this::removeOverlay);
        ((NotificationManager) getReactApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE))
            .cancel(MediaProjectionService.NOTIFICATION_ID);
    }

    @Override public synchronized void invalidate() {
        if (sessionId != null) stopFromNotification(sessionId);
        ui.post(this::removeOverlay);
        super.invalidate();
    }

    public static class StopReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            NagomiScreenShareControlsModule module = active.get();
            if (module != null && ACTION_STOP.equals(intent.getAction())) {
                module.stopFromNotification(intent.getStringExtra("sessionId"));
            }
        }
    }

    public static class Package implements ReactPackage {
        @Override public List<NativeModule> createNativeModules(ReactApplicationContext context) {
            return java.util.Arrays.asList(new NagomiScreenShareControlsModule(context), new NagomiPlaybackAudioModule(context));
        }
        @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) {
            return Collections.emptyList();
        }
    }
}
