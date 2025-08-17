import http.server
import os

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(302)
            self.send_header('Location', '/scratch-modules-gallery')
            self.end_headers()
        else:
            super().do_GET()

    def translate_path(self, path):
        if path.startswith('/scratch-modules-gallery'):
            rel_path = path[len('/scratch-modules-gallery'):]
            return os.path.join(os.getcwd(), 'dist', rel_path.lstrip('/'))
        return super().translate_path(path)

    def send_head(self):
        path = self.translate_path(self.path)
        # 如果请求的是目录，尝试使用该目录下的 index.html
        if os.path.isdir(path):
            index_path = os.path.join(path, 'index.html')
            if os.path.isfile(index_path):
                path = index_path
            if os.path.isfile(path) and path.endswith('.html'):
                with open(path, 'rb') as f:
                    content = f.read().decode('utf-8', errors='replace')
            # 过滤微软分析脚本（以 msclarity、clarity、microsoft clarity 等关键词为例）
            import re
            content = re.sub(
                r'<script>[\s\S]*?(msclarity|clarity|microsoft clarity)[\s\S]*?<\/script>',
                '',
                content,
                flags=re.IGNORECASE
            )
            encoded = content.encode('utf-8')
            self.send_response(200)
            self.send_header("Content-type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
            return None  # 已经写入响应
        return super().send_head()

if __name__ == '__main__':
    http.server.test(HandlerClass=CustomHandler, port=8800)