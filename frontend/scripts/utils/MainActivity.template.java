package __CAPACITOR_APP_ID__;

import android.graphics.*;
import android.os.*;
import android.view.*;
import android.webkit.*;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private View privacyOverlay;
  private volatile boolean privacyEnabled = true;
  private volatile boolean lockScreenActive;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WebView webView = webView();
    if (webView != null) webView.addJavascriptInterface(new Object() {
      @JavascriptInterface
      public void setEnabled(boolean enabled) {
        privacyEnabled = enabled;
        if (!enabled) runOnUiThread(() -> privacy(false));
      }

      @JavascriptInterface
      public void setLockScreenActive(boolean active) {
        lockScreenActive = active;
        if (active) runOnUiThread(() -> privacy(false));
      }
    }, "DailyNotesPrivacy");
  }

  @Override
  public void onPause() {
    privacy(true);
    super.onPause();
  }

  @Override
  public void onResume() {
    super.onResume();
    privacy(false);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    privacy(!hasFocus);
  }

  private void privacy(boolean show) {
    View decorView = getWindow().getDecorView();

    if (!show || !privacyEnabled || lockScreenActive) {
      css(false);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) decorView.setRenderEffect(null);
      if (privacyOverlay != null) {
        ViewGroup parent = (ViewGroup) privacyOverlay.getParent();
        if (parent != null) parent.removeView(privacyOverlay);
        privacyOverlay = null;
      }
      return;
    }

    css(true);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      decorView.setRenderEffect(RenderEffect.createBlurEffect(32f, 32f, Shader.TileMode.CLAMP));
    }
    if (privacyOverlay == null) {
      privacyOverlay = new View(this);
      privacyOverlay.setBackgroundColor(0x5c000000);
      ((ViewGroup) decorView).addView(privacyOverlay, new ViewGroup.LayoutParams(-1, -1));
    }
    privacyOverlay.bringToFront();
  }

  private void css(boolean active) {
    WebView webView = webView();
    String action = active ? "add" : "remove";
    if (webView != null) webView.evaluateJavascript("document.documentElement.classList." + action + "('privacyActive')", null);
  }

  private WebView webView() {
    return getBridge() == null ? null : getBridge().getWebView();
  }
}
