// Async helper to post a message to the extension backend and await a matching response

export function postMessageAwait(vscode, outgoingMessage, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const uniqueId = Math.random().toString(36).substring(2, 15);
        let timeout;
        const cleanup = () => {
            window.removeEventListener("message", onMessage);
            if (timeout) clearTimeout(timeout);
        };
        const onMessage = (event) => {
            try {
                const data = event.data;
                if (data && data._reqId === uniqueId) {
                    cleanup();
                    resolve(data);
                }
            } catch (_) {}
        };
        window.addEventListener("message", onMessage);
        timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for response"));
        }, timeoutMs);
        try {
            outgoingMessage._reqId = uniqueId;
            vscode.postMessage(outgoingMessage);
        } catch (err) {
            cleanup();
            reject(err);
        }
    });
}
