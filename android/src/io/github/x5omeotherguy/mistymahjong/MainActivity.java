package io.github.x5omeotherguy.mistymahjong;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;

/** Runs the game from the APK assets in a full-screen WebView. */
public class MainActivity extends Activity {
    // Reserved for apps: gives the game a secure https origin (localStorage,
    // Web Audio) that is served from assets/game/ and never reaches a network.
    private static final String HOST = "appassets.androidplatform.net";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The game has a timer; the screen must not dim while the player thinks.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        // Remote inspection only in a debuggable build (scripts/build-apk --debug).
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // index.html scales its viewport to the device pixel ratio, as in a mobile browser.
        settings.setUseWideViewPort(true);
        // The background music starts with the menu, before the first touch.
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new GameAssets());
        setContentView(webView);
        webView.loadUrl("https://" + HOST + "/index.html");
    }

    // Static rather than anonymous: d8 34.0.0 crashes on the constructor
    // parameter metadata that JDK 21 javac writes for anonymous classes.
    private static final class GameAssets extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (HOST.equals(url.getHost())) {
                String path = url.getPath().substring(1);
                try {
                    return new WebResourceResponse(mimeType(path), null,
                            view.getContext().getAssets().open("game/" + path));
                } catch (IOException e) {
                    // Missing asset: answered below.
                }
            }
            // Nothing else is ever served: the app holds no INTERNET permission either.
            return new WebResourceResponse("text/plain", null, 404, "Not Found", null,
                    new ByteArrayInputStream(new byte[0]));
        }

        private static String mimeType(String path) {
            String extension = path.substring(path.lastIndexOf('.') + 1);
            String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            return type != null ? type : "application/octet-stream";
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    // The page also listens for visibilitychange; the explicit events make
    // the pause and the muting independent of the WebView's own timing.
    @Override
    protected void onPause() {
        super.onPause();
        webView.evaluateJavascript("document.dispatchEvent(new Event('app-pause'))", null);
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        webView.evaluateJavascript("document.dispatchEvent(new Event('app-resume'))", null);
    }

    // A stray back gesture at the screen edge must not end the running game.
    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }
}
