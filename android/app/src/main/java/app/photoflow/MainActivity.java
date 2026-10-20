package app.photoflow;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import app.photoflow.plugins.NextcloudWebDavPlugin;
import app.photoflow.plugins.PhotoManagerPlugin;
import app.photoflow.plugins.PhotoScannerPlugin;
import app.photoflow.plugins.PhotoThumbnailPlugin;
import app.photoflow.plugins.SecureStorePlugin;
import app.photoflow.plugins.UploadWorkPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PhotoScannerPlugin.class);
        registerPlugin(PhotoThumbnailPlugin.class);
        registerPlugin(PhotoManagerPlugin.class);
        registerPlugin(NextcloudWebDavPlugin.class);
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(UploadWorkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
