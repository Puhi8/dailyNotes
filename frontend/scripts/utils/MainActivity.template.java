package __CAPACITOR_APP_ID__;

import android.content.*;
import android.os.*;
import android.view.*;
import android.webkit.*;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final int PRIVACY_OVERLAY_COLOR = 0xff23272f;

  private View privacyOverlay;
  private volatile boolean privacyEnabled = true;
  private volatile boolean lockScreenActive;
  private volatile boolean finishingForExit;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    syncRecentsScreenshotPrivacy();
    ensurePrivacyOverlay();

    WebView webView = webView();
    if (webView != null) {
      webView.addJavascriptInterface(new Object() {
        @JavascriptInterface
        public void setEnabled(boolean enabled) {
          privacyEnabled = enabled;
          runOnUiThread(() -> {
            syncRecentsScreenshotPrivacy();
            if (!enabled) privacy(false);
          });
        }

        @JavascriptInterface
        public void setLockScreenActive(boolean active) {
          lockScreenActive = active;
          if (active) runOnUiThread(() -> privacy(false));
        }

        @JavascriptInterface
        public void prepareForExit() {
          finishingForExit = true;
          runOnUiThread(() -> privacy(false));
        }
      }, "DailyNotesPrivacy");
    }
  }

  @Override
  protected void onUserLeaveHint() {
    privacy(!shouldSkipPrivacy());
    super.onUserLeaveHint();
  }

  @Override
  public void onPause() {
    privacy(!shouldSkipPrivacy());
    super.onPause();
  }

  @Override
  public void onStop() {
    privacy(!shouldSkipPrivacy());
    super.onStop();
  }

  @Override
  public void onResume() {
    super.onResume();
    finishingForExit = false;
    syncRecentsScreenshotPrivacy();
    privacy(false);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    if (!hasFocus) privacy(!shouldSkipPrivacy());
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus || shouldSkipPrivacy()) privacy(false);
  }

  @Override
  public void onTrimMemory(int level) {
    if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) privacy(!shouldSkipPrivacy());
    super.onTrimMemory(level);
  }

  private boolean shouldSkipPrivacy() {
    return finishingForExit || isFinishing() || isDestroyed();
  }

  private void syncRecentsScreenshotPrivacy() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setRecentsScreenshotEnabled(!privacyEnabled);
    }
  }

  private void ensurePrivacyOverlay() {
    if (privacyOverlay != null) return;
    ViewGroup root = findViewById(android.R.id.content);
    if (root == null) return;

    privacyOverlay = new View(this);
    privacyOverlay.setBackgroundColor(PRIVACY_OVERLAY_COLOR);
    privacyOverlay.setClickable(true);
    privacyOverlay.setFocusable(false);
    privacyOverlay.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    privacyOverlay.setVisibility(View.GONE);
    privacyOverlay.setElevation(999999f);
    root.addView(
      privacyOverlay,
      new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    );
  }

  private void privacy(boolean show) {
    ensurePrivacyOverlay();
    boolean active = show && privacyEnabled && !lockScreenActive && !shouldSkipPrivacy();
    if (privacyOverlay != null) {
      privacyOverlay.setVisibility(active ? View.VISIBLE : View.GONE);
      if (active) {
        privacyOverlay.bringToFront();
        privacyOverlay.invalidate();
      }
    }
  }

  private WebView webView() {
    return getBridge() == null ? null : getBridge().getWebView();
  }
}
