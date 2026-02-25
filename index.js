// --- 核心辅助函数 ---

function createHtmlResponse(body, status = 200, headers = {}) {
    return new Response(body, {
      status,
      headers: { 
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        ...headers
      }
    });
  }
  
  function createJsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
  
  function escapeHtml(text) {
    if (!text) return "";
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }
  
  // --- 数据库操作 ---
  
  async function ensureTableExists(db) {
    if (!db) return;
    try {
      await db.prepare('SELECT 1 FROM media LIMIT 1').first();
      await db.prepare('SELECT 1 FROM sessions LIMIT 1').first();
    } catch (e) {
      console.log('初始化数据库...');
      await db.prepare('CREATE TABLE IF NOT EXISTS media (url TEXT PRIMARY KEY, file_id TEXT, message_id INTEGER, timestamp INTEGER)').run();
      await db.prepare('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT, expire_at INTEGER)').run();
    }
  }
  
  async function createSession(db, username) {
    const token = crypto.randomUUID();
    const expireAt = Date.now() + 24 * 60 * 60 * 1000; // 24小时有效期
    await db.prepare('INSERT INTO sessions (token, username, expire_at) VALUES (?, ?, ?)').bind(token, username, expireAt).run();
    return token;
  }
  
  async function getSessionUser(db, token) {
    if (!db) return null;
    const record = await db.prepare('SELECT username, expire_at FROM sessions WHERE token = ?').bind(token).first();
    if (!record) return null;
    if (Date.now() > record.expire_at) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return null;
    }
    return record.username;
  }
  
  // --- 业务主入口 ---
  
  export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      const pathname = url.pathname;
      
      const config = {
        domain: env.DOMAIN,
        database: env.DATABASE,
        username: env.USERNAME || 'admin',
        password: env.PASSWORD || 'password',
        adminPath: env.ADMIN_PATH || 'admin',
        tgBotToken: env.TG_BOT_TOKEN,
        tgChatId: env.TG_CHAT_ID,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
        turnstileSecret: env.TURNSTILE_SECRET_KEY
      };
  
      if (!config.tgBotToken || !config.tgChatId) {
        return createHtmlResponse('系统错误：请在 Workers 环境变量中配置 TG_BOT_TOKEN 和 TG_CHAT_ID', 500);
      }
      if (!config.turnstileSiteKey || !config.turnstileSecret) {
        return createHtmlResponse('系统错误：请配置 TURNSTILE_SITE_KEY 和 TURNSTILE_SECRET_KEY', 500);
      }
  
      try {
        // 初始化数据库
        await ensureTableExists(config.database);
  
        // 1. 公共路由：登录页
        if (pathname === '/login') {
          if (request.method === 'GET') {
            return handleLoginPage(config);
          } else if (request.method === 'POST') {
            return handleLoginAction(request, config);
          }
        }
  
        // 2. 登出路由 (需要验证当前Token属于当前用户，或者直接清除)
        if (pathname === '/logout') {
          return handleLogoutAction();
        }
  
        // 3. 获取 Session 用户
        const sessionToken = request.headers.get("Cookie")?.match(/session_token=([^;]+)/)?.[1];
        const user = sessionToken ? await getSessionUser(config.database, sessionToken) : null;
  
        // 4. 受保护的资源 (检查登录状态)
        if (!user) {
          // 如果未登录，除了 /login 之外的所有请求都重定向到登录页
          return createHtmlResponse('', 302, { 'Location': '/login' });
        }
  
        // 5. 业务路由 (已登录)
        if (pathname === '/') return handleRootRequest(config);
        if (pathname === `/${config.adminPath}`) return handleAdminRequest(request, config);
        if (pathname === '/upload') return request.method === 'POST' ? handleSendRequest(request, config) : new Response('Method Not Allowed', { status: 405 });
        if (pathname === '/delete-images') return handleDeleteImagesRequest(request, config);
        if (pathname === '/api/status') return createJsonResponse({ loggedIn: true, username: user });
        
        return new Response('404 Not Found', { status: 404 });
      } catch (e) {
        console.error(e);
        return createHtmlResponse(`服务器错误: ${e.message}`, 500);
      }
    }
  };
  
  // --- 认证逻辑 ---
  
  function handleLoginPage(config) {
      var s = [];
      s.push("<!DOCTYPE html><html lang=\"zh-CN\"><head>");
      s.push("<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
      s.push("<title>系统登录</title>");
      s.push("<script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\" async defer></script>");
      s.push("<style>");
      s.push("body{background:#f0f2f5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif}");
      s.push(".login-box{background:#fff;padding:40px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);width:100%;max-width:320px}");
      s.push("h2{text-align:center;color:#333;margin-bottom:25px}");
      s.push("input{width:100%;padding:12px;margin:10px 0;border:1px solid #ddd;border-radius:4px;box-sizing:border-box}");
      s.push("button{width:100%;padding:12px;background:#0088cc;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px; margin-top:10px}");
      s.push("button:hover{background:#0077b5}");
      s.push("#error-msg{color:red;text-align:center;margin-bottom:15px;font-size:13px}");
      s.push("</style></head>");
      s.push("<body><div class=\"login-box\"><h2>系统登录</h2>");
      s.push("<form method=\"POST\" onsubmit=\"return validate(event)\">");
      s.push("<input type=\"text\" name=\"username\" placeholder=\"用户名\" required value=\"admin\">");
      s.push("<input type=\"password\" name=\"password\" placeholder=\"密码\" required>");
      s.push("<div class=\"cf-turnstile\" data-sitekey=\"" + escapeHtml(config.turnstileSiteKey) + "\"></div>");
      s.push("<div id=\"error-msg\"></div>");
      s.push("<button type=\"submit\" id=\"submit-btn\">登 录</button>");
      s.push("</form>");
      s.push("<script>");
      s.push("function validate(e){");
      s.push(" var t = document.querySelector('.cf-turnstile textarea').value;");
      s.push(" if(!t) { document.getElementById('error-msg').innerText='请先完成人机验证'; return false; }");
      s.push(" document.getElementById('submit-btn').disabled = true; return true;");
      s.push("}");
      s.push("</script></div></body></html>");
      return createHtmlResponse(s.join(''));
  }
  
  async function handleLoginAction(request, config) {
      const formData = await request.formData();
      const username = formData.get('username');
      const password = formData.get('password');
      const captcha = formData.get("cf-turnstile-response");
  
      if (!config.database) return new Response("Database not configured", 500);
  
      // 1. 验证 Turnstile
      try {
          const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
              method: "POST",
              body: new URLSearchParams({
                  secret: config.turnstileSecret,
                  response: captcha
              }),
              headers: { "Content-Type": "application/x-www-form-urlencoded" }
          });
          const verifyData = await verifyRes.json();
          if (!verifyData.success) {
              return createHtmlResponse("<script>alert('人机验证失败，请刷新重试');location.href='/login';</script>");
          }
      } catch(e) {
           return createHtmlResponse("<script>alert('验证码服务错误');location.href='/login';</script>");
      }
  
      // 2. 验证账号密码
      if (username === config.username && password === config.password) {
          const token = await createSession(config.database, username);
          return createHtmlResponse('<script>location.href="/";</script>', 200, {
              'Set-Cookie': `session_token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
          });
      } else {
          return createHtmlResponse("<script>alert('用户名或密码错误');location.href='/login';</script>");
      }
  }
  
  function handleLogoutAction() {
      return createHtmlResponse('<script>location.href="/login";</script>', 200, {
          'Set-Cookie': 'session_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
      });
  }
  
  // --- 前台页面 (发送页面) ---
  
  function handleRootRequest(config) {
    var s = [];
    s.push("<!DOCTYPE html>");
    s.push("<html lang=\"zh-CN\">");
    s.push("<head>");
    s.push("  <meta charset=\"UTF-8\">");
    s.push("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
    s.push("  <title>TG 消息发送面板</title>");
    s.push("  <link href=\"https://cdnjs.cloudflare.com/ajax/libs/bootstrap/4.6.1/css/bootstrap.min.css\" rel=\"stylesheet\">");
    s.push("  <link href=\"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css\" rel=\"stylesheet\">");
    s.push("  <style>");
    s.push("    body { background-color: #f4f6f9; font-family: -apple-system, sans-serif; margin: 0; min-height: 100vh; display: flex; justify-content: center; align-items: center; }");
    s.push("    .send-card { background: #fff; width: 100%; max-width: 650px; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); position: relative; overflow: hidden; margin: 20px; }");
    s.push("    .send-card::before { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 5px; background: linear-gradient(90deg, #0088cc, #00aadd); }");
    s.push("    h2.text-center { color: #333; font-weight: 600; margin-bottom: 30px; margin-top: 10px; }");
    s.push("    .user-panel { position: absolute; top: 15px; right: 20px; z-index: 10; }");
    s.push("    .btn-user { background: #fff; border: 1px solid #e0e0e0; color: #555; padding: 6px 15px; border-radius: 20px; font-size: 13px; }");
    s.push("    .btn-user:hover { background: #f8f9fa; color: #000; }");
    s.push("    textarea.form-control { resize: none; border-radius: 8px; border: 1px solid #dce1e8; background-color: #f9fbfd; }");
    s.push("    #drop-area { border: 2px dashed #dce1e8; border-radius: 8px; padding: 20px; text-align: center; background: #fafbfc; cursor: pointer; min-height: 100px; }");
    s.push("    #drop-area:hover { border-color: #0088cc; background: #f0f8ff; }");
    s.push("    .file-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #eee; margin-bottom: 5px; border-radius: 4px; }");
    s.push("  </style>");
    s.push("</head>");
    s.push("<body>");
    s.push("<div class=\"send-card\">");
    s.push("    <div class=\"user-panel\">");
    s.push("        <div class=\"dropdown\" id=\"userDropdown\">");
    s.push("            <button class=\"btn btn-user dropdown-toggle\" type=\"button\" data-toggle=\"dropdown\">");
    s.push("                <i class=\"fas fa-user-circle\"></i> <span id=\"userStatusText\">用户</span>");
    s.push("            </button>");
    s.push("            <div class=\"dropdown-menu dropdown-menu-right\">");
    s.push("                <a class=\"dropdown-item\" href=\"/" + escapeHtml(config.adminPath) + "\">后台管理</a>");
    s.push("                <div class=\"dropdown-divider\"></div>");
    s.push("                <a class=\"dropdown-item\" href=\"#\" onclick=\"doLogout()\">退出登录</a>");
    s.push("            </div>");
    s.push("        </div>");
    s.push("    </div>");
    s.push("    <h2 class=\"text-center\"><i class=\"fab fa-telegram\" style=\"color: #0088cc;\"></i> 消息发送面板</h2>");
    s.push("    <input type=\"file\" id=\"fileInput\" multiple accept=\"image/*\" style=\"display: none;\">");
    s.push("    <textarea id=\"messageText\" class=\"form-control mt-3\" rows=\"4\" placeholder=\"在此输入消息内容（选填）...\"></textarea>");
    s.push("    <label for=\"fileInput\" style=\"margin:10px 0; cursor:pointer; width:100%; display:block;\">");
    s.push("        <div id=\"drop-area\">");
    s.push("            <i class=\"fas fa-paperclip fa-2x\" style=\"color: #cbd0d6;\"></i><br>");
    s.push("            <span style=\"color:#666; font-size:13px\">点击添加图片 (或拖拽)</span>");
    s.push("        </div>");
    s.push("    </label>");
    s.push("    <div id=\"fileList\" style=\"margin-bottom:20px;\"></div>");
    s.push("    <div class=\"progress-wrapper\" id=\"progressWrapper\" style=\"display:none\">");
    s.push("        <div class=\"progress\"><div class=\"progress-bar\" id=\"progressBar\"></div></div>");
    s.push("        <small id=\"progressText\" style=\"color:#666; text-align:right; display:block\"></small>");
    s.push("    </div>");
    s.push("    <div class=\"result-area\" id=\"resultArea\" style=\"display:none; margin-top:20px;\">");
    s.push("        <label><i class=\"fas fa-link\"></i> 返回结果:</label>");
    s.push("        <textarea id=\"resultLinks\" class=\"form-control\" rows=\"3\" readonly></textarea>");
    s.push("        <button class=\"btn btn-secondary btn-custom mt-2\" onclick=\"copyResult()\"><i class=\"fas fa-copy\"></i> 复制内容</button>");
    s.push("    </div>");
    s.push("    <div style=\"display:flex; justify-content:space-between; margin-top:20px;\">");
    s.push("        <button class=\"btn btn-secondary btn-custom\" onclick=\"document.getElementById('fileInput').click()\">添加附件</button>");
    s.push("        <button id=\"sendBtn\" class=\"btn btn-primary btn-custom\">发送</button>");
    s.push("    </div>");
    s.push("</div>");
    
    s.push("<script src=\"https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js\"></script>");
    s.push("<script src=\"https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.14.7/umd/popper.min.js\"></script>");
    s.push("<script src=\"https://cdnjs.cloudflare.com/ajax/libs/bootstrap/4.6.1/js/bootstrap.min.js\"></script>");
    s.push("<script>");
    s.push("$(document).ready(function() {");
    s.push("    var selectedFiles = [];");
    s.push("    window.doLogout = async function() {");
    s.push("        if(!confirm('确定退出登录吗？')) return;");
    s.push("        try {");
    s.push("            await fetch('/logout', { method: 'POST' });");
    s.push("        } catch (e) { console.log(e); }");
    s.push("        window.location.href = '/';");
    s.push("    };");
    s.push("");
    s.push("    $('#fileInput').change(e => {");
    s.push("        selectedFiles = Array.from(e.target.files);");
    s.push("        updateFileList();");
    s.push("    });");
    s.push("");
    s.push("    function updateFileList() {");
    s.push("        var html = selectedFiles.map((f, i) => {");
    s.push("            return '<div class=\"file-item\"><span>' + escapeHtml(f.name) + '</span> <button type=\"button\" class=\"btn btn-link text-danger p-0\" onclick=\"removeFile(' + i + ')\">&times;</button></div>';");
    s.push("        }).join('');");
    s.push("        $('#fileList').html(html);");
    s.push("    }");
    s.push("");
    s.push("    window.removeFile = function(idx) {");
    s.push("        selectedFiles.splice(idx, 1);");
    s.push("        updateFileList();");
    s.push("    };");
    s.push("");
    s.push("    function compress(file, q) {");
    s.push("        q = q || 0.7;");
    s.push("        return new Promise(r => {");
    s.push("            if (!file.type.startsWith('image/') || file.type === 'image/gif') return r(file);");
    s.push("            var img = new Image();");
    s.push("            var reader = new FileReader();");
    s.push("            reader.onload = e => {");
    s.push("                img.src = e.target.result;");
    s.push("                img.onload = () => {");
    s.push("                    var canvas = document.createElement('canvas');");
    s.push("                    canvas.width = img.width; canvas.height = img.height;");
    s.push("                    canvas.getContext('2d').drawImage(img, 0, 0);");
    s.push("                    canvas.toBlob(b => r(new File([b], file.name, {type:'image/jpeg'})), 'image/jpeg', q);");
    s.push("                };");
    s.push("            };");
    s.push("            reader.readAsDataURL(file);");
    s.push("        });");
    s.push("    }");
    s.push("");
    s.push("    $('#sendBtn').click(async function() {");
    s.push("        var text = $('#messageText').val();");
    s.push("        if (!selectedFiles.length && !text.trim()) return alert('请输入内容或选择文件');");
    s.push("        $('#progressWrapper').show();");
    s.push("        var results = [];");
    s.push("        var count = selectedFiles.length;");
    s.push("        try {");
    s.push("            for (let i=0; i<count; i++) {");
    s.push("                var f = selectedFiles[i];");
    s.push("                $('#progressText').text('正在发送 ' + (i+1) + '/' + count);");
    s.push("                $('#progressBar').css('width', Math.round((i/count)*100) + '%');");
    s.push("                var cf = await compress(f);");
    s.push("                var fd = new FormData();");
    s.push("                fd.append('file', cf);");
    s.push("                fd.append('message', text);");
    s.push("                var res = await fetch('/upload', { method:'POST', body:fd });");
    s.push("                var d = await res.json();");
    s.push("                if (d.error) throw new Error(d.error + ': ' + f.name);");
    s.push("                results.push(d.data);");
    s.push("            }");
    s.push("            if (count === 0 && text) {");
    s.push("                var fd = new FormData(); fd.append('message', text);");
    s.push("                var res = await fetch('/upload', { method:'POST', body:fd });");
    s.push("                var d = await res.json();");
    s.push("                if (d.error) throw new Error(d.error);");
    s.push("                results.push('【文本已发送】');");
    s.push("            }");
    s.push("            alert('发送成功！');");
    s.push("            $('#resultLinks').val(results.join('\\n'));");
    s.push("            $('#resultArea').show();");
    s.push("            selectedFiles = [];");
    s.push("            $('#fileList').empty();");
    s.push("            $('#messageText').val('');");
    s.push("        } catch(e) { alert('发送失败: ' + e.message); }");
    s.push("        $('#progressBar').css('width', '100%');");
    s.push("    });");
    s.push("});");
    s.push("function escapeHtml(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }");
    s.push("function copyResult() { var copyText = document.getElementById('resultLinks'); copyText.select(); document.execCommand('copy'); alert('复制成功'); }");
    s.push("</script>");
    s.push("</body>");
    s.push("</html>");
    
    return createHtmlResponse(s.join(''));
  }
  
  // --- 后台页面 (图库管理) ---
  
  async function handleAdminRequest(request, config) {
    if (!config.database) return createHtmlResponse('错误：未绑定 D1 数据库', 500);
  
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = 60;
    const offset = (page - 1) * pageSize;
    
    var countRes = await config.database.prepare('SELECT COUNT(*) as count FROM media').first();
    var total = countRes ? countRes.count : 0;
    var totalPages = Math.ceil(total / pageSize); 
  
    var results = await config.database.prepare('SELECT url, timestamp FROM media ORDER BY timestamp DESC LIMIT ? OFFSET ?').bind(pageSize, offset).all();
  
    var s = [];
    s.push("<!DOCTYPE html>");
    s.push("<html lang=\"zh-CN\">");
    s.push("<head>");
    s.push("<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
    s.push("<title>后台管理</title>");
    s.push("<link href=\"https://cdnjs.cloudflare.com/ajax/libs/bootstrap/4.6.1/css/bootstrap.min.css\" rel=\"stylesheet\">");
    s.push("<link href=\"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css\" rel=\"stylesheet\">");
    s.push("<style>");
    s.push("body { background:#f0f2f5; font-family:inherit; margin:0 }");
    s.push(".navbar { background:#fff; padding:15px 30px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.05); display:flex; justify-content:space-between }");
    s.push(".actions { display:flex; align-items:center; gap:15px }");
    s.push(".badge-count { background:#0088cc; color:#fff; padding:5px 12px; border-radius:15px }");
    s.push(".gallery-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:15px; padding:0 30px 30px }");
    s.push(".img-card { position:relative; background:#fff; border-radius:8px; overflow:hidden; cursor:pointer; border:2px solid transparent; box-shadow:0 1px 3px rgba(0,0,0,0.1) }");
    s.push(".img-card.selected { border-color:#0088cc }");
    s.push(".img-wrapper { height:140px; overflow:hidden }");
    s.push(".img-wrapper img { width:100%; height:100%; object-fit:cover }");
    s.push(".check-overlay { position:absolute; top:5px; right:5px; width:24px; height:24px; background:#0088cc; border-radius:50%; color:#fff; display:flex; align-items:center; justify-content:center; opacity:0 }");
    s.push(".img-card.selected .check-overlay { opacity:1 }");
    s.push(".pagination { justify-content:center; margin-bottom:30px }");
    s.push("</style></head>");
    s.push("<body>");
    s.push("<nav class=\"navbar\">");
    s.push("  <div><a href=\"/\" class=\"btn btn-outline-secondary\"><i class=\"fas fa-arrow-left\"></i> 返回前台</a> <span style=\"margin-left:15px; font-weight:600\">后台图库</span></div>");
    s.push("  <div class=\"actions\">");
    s.push("    <span>已选中: <span id=\"count\" class=\"badge-count\">0</span></span>");
    s.push("    <div>");
    s.push("      <button class=\"btn btn-light\" onclick=\"copyUrls()\"><i class=\"fas fa-copy\"></i> 复制</button>");
    s.push("      <button class=\"btn btn-danger\" onclick=\"deleteImages()\">删除</button>");
    s.push("    </div>");
    s.push("  </div>");
    s.push("</nav>");
    
    s.push("<div class=\"gallery-grid\">");
    results.results.forEach(function(item) {
      s.push('<div class="img-card" onclick="toggle(this)" data-url="' + escapeHtml(item.url) + '">');
      s.push('  <div class="img-wrapper"><img src="' + escapeHtml(item.url) + '" loading="lazy"></div>');
      s.push('  <div class="check-overlay"><i class="fas fa-check"></i></div>');
      s.push('</div>');
    });
    s.push("</div>");
    
    s.push("<nav><ul class=\"pagination\">");
    s.push('<li class="page-item ' + (page<=1?'disabled':'') + '"><a class="page-link" href="?page=' + (page-1) + '">上一页</a></li>');
    s.push('<li class="page-item active"><a class="page-link">' + page + '/' + totalPages + ' (共' + total + ')</a></li>');
    s.push('<li class="page-item ' + (page>=totalPages?'disabled':'') + '"><a class="page-link" href="?page=' + (page+1) + '">下一页</a></li>');
    s.push("</ul></nav>");
    
    s.push("<script>");
    s.push("var selected = new Set();");
    s.push("function toggle(el) {");
    s.push("  var u = el.dataset.url;");
    s.push("  if(selected.has(u)) { selected.delete(u); el.classList.remove('selected'); }");
    s.push("  else { selected.add(u); el.classList.add('selected'); }");
    s.push("  document.getElementById('count').textContent = selected.size;");
    s.push("}");
    s.push("async function deleteImages() {");
    s.push("  if(selected.size===0) return alert('请先选择');");
    s.push("  if(!confirm('确定删除?')) return;");
    s.push("  var res = await fetch('/delete-images', {method:'POST', body:JSON.stringify(Array.from(selected))});");
    s.push("  if(res.ok) { alert('成功'); location.reload(); } else alert('失败');");
    s.push("}");
    s.push("function copyUrls() {");
    s.push("  if(selected.size===0) return alert('请先选择');");
    s.push("  navigator.clipboard.writeText(Array.from(selected).join('\\n')).then(()=>alert('已复制'));");
    s.push("}");
    s.push("</script></body></html>");
    
    return createHtmlResponse(s.join(''));
  }
  
  // --- 发送接口 ---
  async function handleSendRequest(request, config) {
    const formData = await request.formData();
    const file = formData.get('file');
    const message = formData.get('message'); 
  
    try {
      if (file) {
        const tgUrl = `https://api.telegram.org/bot${config.tgBotToken}/sendPhoto`;
        const tgFormData = new FormData();
        tgFormData.append('chat_id', config.tgChatId);
        tgFormData.append('caption', message ? message : file.name);
        tgFormData.append('parse_mode', 'HTML'); 
        tgFormData.append('photo', file);
  
        const res = await fetch(tgUrl, { method: 'POST', body: tgFormData });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'TG Error');
  
        const fileId = data.result.photo[data.result.photo.length - 1].file_id;
        const fileRes = await fetch(`https://api.telegram.org/bot${config.tgBotToken}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        if (!fileData.ok) throw new Error('Get Path Error');
  
        const finalUrl = `https://api.telegram.org/file/bot${config.tgBotToken}/${fileData.result.file_path}`;
  
        if (config.database) {
          try {
            await config.database.prepare('INSERT INTO media (url, file_id, message_id, timestamp) VALUES (?, ?, ?, ?)').bind(finalUrl, fileId, data.result.message_id, Date.now()).run();
          } catch (e) { console.error('DB Write Error:', e); }
        }
        return createJsonResponse({ data: finalUrl });
      } else if (message) {
        const tgUrl = `https://api.telegram.org/bot${config.tgBotToken}/sendMessage`;
        const payload = { chat_id: config.tgChatId, text: message, parse_mode: 'HTML' };
        const res = await fetch(tgUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'TG Send Error');
        return createJsonResponse({ data: '【文本发送成功】' });
      } else {
        return createJsonResponse({ error: '无效请求：无内容' }, 400);
      }
    } catch (error) {
      console.error(error);
      return createJsonResponse({ error: error.message }, 500);
    }
  }
  
  // --- 删除接口 ---
  async function handleDeleteImagesRequest(request, config) {
    // 已经在主入口检查过登录状态，这里直接操作
    const urls = await request.json();
    if (!Array.isArray(urls) || urls.length === 0) return createJsonResponse({ error: '无效的数据' }, 400);
  
    try {
      const placeholders = urls.map(() => '?').join(',');
      const rows = await config.database.prepare(`SELECT url, message_id FROM media WHERE url IN (${placeholders})`).bind(...urls).all();
  
      const deletePromises = rows.results.map(row => 
        fetch(`https://api.telegram.org/bot${config.tgBotToken}/deleteMessage?chat_id=${config.tgChatId}&message_id=${row.message_id}`)
      );
      await Promise.all(deletePromises);
  
      await config.database.prepare(`DELETE FROM media WHERE url IN (${placeholders})`).bind(...urls).run();
      return createJsonResponse({ success: true });
    } catch (e) {
      return createJsonResponse({ error: e.message }, 500);
    }
  }
  