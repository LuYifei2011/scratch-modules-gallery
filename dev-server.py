import http.server
import os

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            # 发送 302 重定向到 /scratch-modules-gallery
            self.send_response(302)
            self.send_header('Location', '/scratch-modules-gallery')
            self.end_headers()
        else:
            super().do_GET()

    def translate_path(self, path):
        # 如果以 /scratch-modules-gallery 开头，映射到 ./dist 目录
        if path.startswith('/scratch-modules-gallery'):
            rel_path = path[len('/scratch-modules-gallery'):]
            return os.path.join(os.getcwd(), 'dist', rel_path.lstrip('/'))
        return super().translate_path(path)

if __name__ == '__main__':
    http.server.test(HandlerClass=CustomHandler, port=8800)