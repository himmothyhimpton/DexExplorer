import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "@/index.css";
import App from "@/App";

// In development, quiet logs for intentionally canceled requests
if (process.env.NODE_ENV === "development") {
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const msg = error?.message || "";
      const isCanceled = (error && (error.name === "CanceledError" || error.name === "AbortError"))
        || (error && error.code === "ERR_CANCELED")
        || /aborted|canceled/i.test(msg);
      if (isCanceled) {
        try {
          const url = error?.config?.url || "";
          console.debug("Request canceled:", url);
        } catch {}
        // Propagate as rejection so calling code behaves correctly
        return Promise.reject(error);
      }
      return Promise.reject(error);
    }
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
// In development, avoid StrictMode double-invocation that can cause duplicate effects/aborts
if (process.env.NODE_ENV === 'development') {
  root.render(<App />);
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
