const http = require("http");
const url = require("url");
const path = require("path");
const port = 4400;
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");

let sessions = {};
const answers = {
    "valid path": "Use absolute path like C:\\Users\\YourName\\Documents. Do not include quotes.",

    "structure search": "Structure search works only inside the last analyzed folder. It is faster and memory-based.",

    "system search": "System search scans entire system directories. It is slower but broader.",

    "session duration": "Session remains active for 2 hours. After that, you must login again.",

    "invalid path": "Ensure folder exists and path is correct. Do not add extra quotes."
};

function responseAnswer(question) {
    console.log(question)
    if (!question) {
        return "ask a valid question";
    }

    const lowerCaseQuestion = question.toLowerCase();
    if (lowerCaseQuestion.includes("path")) {
        return answers["valid path"];
    }

    if (lowerCaseQuestion.includes("structure")) {
        return answers["structure search"];
    }

    if (lowerCaseQuestion.includes("system")) {
        return answers["system search"];
    }

    if (lowerCaseQuestion.includes("session")) {
        return answers["session duration"];
    }

    return "Sorry i can't find any response. please check help section";
}

async function check_addData(username, email, password, res) {
    try {
        const data = await fs.readFile("./data/users.json", "utf-8");
        let users = JSON.parse(data);

        const userExist = users.find(user => user.username === username)
        if (userExist) {
            res.writeHead(400, { "Content-type": "text/plain" });
            return res.end("username is exist! please try diffrent")
        }

        const emailExist = users.find(user => user.email === email)
        if (emailExist) {
            res.writeHead(400, { "Content-type": "text/plain" });
            return res.end("email is exist! enter diffrent mail")
        }
        const newUser = { username, email, password }

        users.push(newUser)

        await fs.writeFile("./data/users.json", JSON.stringify(users, null, 2));
        res.writeHead(200, { "Content-type": "text/plain" });
        res.end("registration done")
    } catch (err) {
        res.writeHead(500, { "Content-type": "text/plain" });
        res.end("server error")
    }

}

function isAuthentication(req, res) {
    const cookies = req.headers.cookie;
    if (!cookies) {
        res.writeHead(302, { "Location": "/login" });
        res.end();
        return null;
    }

    const parsCookies = Object.fromEntries(cookies.split("; ").map(c => c.split("=")))

    const sessionId = parsCookies.sessionId;

    if (!sessionId || !sessions[sessionId]) {
        res.writeHead(302, { "Location": "/login" });
        res.end();
        return null;
    }

    const session = sessions[sessionId];

    if (!session) {
        res.writeHead(302, { "location": "/login" });
        res.end();
        return null;
    }
    if (Date.now() > session.expireAt) {
        delete sessions[sessionId]
        res.writeHead(302, {
            "set-Cookie": "sessionId=; Max-Age = 0",
            "location": "/login"
        })
        res.end();
        return null;
    }

    return session;
}

function validatePath(folderPath) {
    console.log("validatefunction", folderPath);

    if (!folderPath) {
        return false;
    }
    const pathResolve = path.resolve(folderPath);
    console.log("path resolve", pathResolve)

    if (!fsSync.existsSync(pathResolve)) {
        return false
    }
    if (!fsSync.lstatSync(pathResolve).isDirectory()) {
        return false;
    }

    return pathResolve;
}

async function checkFolder(currentPath, data) {
    const items = await fs.readdir(currentPath);

    for (let item of items) {
        const fullPath = path.join(currentPath, item);
        const obj = await fs.stat(fullPath);

        data.paths.push(fullPath);

        if (obj.isDirectory()) {
            data.folders++;
            await checkFolder(fullPath, data);
        } else {
            data.files++;
        }
    }
}

async function structure(dirPath) {
    let data = {
        paths: [],
        files: 0,
        folders: 0,
    }
    await checkFolder(dirPath, data);

    return data;
}

function steps(fullPath) {
    const parts = fullPath.split("\\");

    let instruction = "\nNavigation Steps:\n";

    parts.forEach((part, index) => {
        instruction += `Step ${index + 1}: Open "${part}"\n`;
    });

    instruction += "\n";

    return instruction;
}

function buildTree(paths) {
    const tree = {};

    paths.forEach(filePath => {
        const parts = filePath.split(/[/\\]+/); // support windows + linux
        let current = tree;

        parts.forEach(part => {
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        });
    });

    function formatTree(obj, indent = "") {
        let output = "";

        for (let key in obj) {
            output += indent + "├── " + key + "\n";
            output += formatTree(obj[key], indent + "│   ");
        }

        return output;
    }

    return formatTree(tree);
}

http.createServer(async (req, res) => {
    const pathUrl = url.parse(req.url, true);
    const pathName = pathUrl.pathname;
    const method = req.method;

    //home
    if ((pathName === "/" || pathName === "/home") && method === "GET") {

        const session = isAuthentication(req, res);
        if (!session) {
            return
        }
        try {
            let dashboard = await fs.readFile("./public/html/dashboard.html", "utf-8");
            let userFile = await fs.readFile("./data/users.json", "utf-8");
            let users = JSON.parse(userFile)
            // console.log(users)
            let user = users.find(e => e.email === session.email);
            // console.log(user);


            const time = Math.floor((session.expireAt - Date.now()) / (1000 * 60));
            // console.log(time)
            dashboard = dashboard.replace("{{username}}", user.username)
            dashboard = dashboard.replace("{{expiry}}", time)
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(dashboard);
        } catch (err) {
            res.writeHead(500, { "Content-type": "text/plain" });
            return res.end("error loding dashboard page")
        }
    }

    //login request
    else if (pathName === "/login" && method === "GET") {
        try {

            const data = await fs.readFile("./public/html/login.html");
            res.writeHead(200, { "Content-type": "text/html" });
            res.end(data);
        } catch (err) {
            res.writeHead(500);
            res.end("error loading login page");
        }
    } else if (pathName == "/login" && method === "POST") {
        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        })

        req.on("end", async () => {
            console.log(body)
            const data = new URLSearchParams(body)

            const email = data.get("email")
            const password = data.get("password")
            // console.log(email, password)
            try {
                const datafile = await fs.readFile("./data/users.json")
                const users = JSON.parse(datafile);

                const user = users.find(e => e.email === email)
                if (!user) {
                    res.writeHead(400, { "Content-type": "text/plain" });
                    return res.end("user not found")
                }
                if (user.password !== password) {
                    res.writeHead(400, { "Content-type": "text/plain" });
                    return res.end("password doesn't match!")
                }
                const sessionId = crypto.randomBytes(16).toString("hex");


                sessions[sessionId] = {
                    email: user.email,
                    createdAt: Date.now(),
                    expireAt: Date.now() + 2 * 60 * 60 * 1000
                }

                res.writeHead(302, {
                    "set-cookie": `sessionId= ${sessionId}; HttpOnly`,
                    "location": "/home"
                })
                res.end();
            } catch (err) {
                console.error(err);
                res.writeHead(500, { "Content-type": "text/plain" });
                res.end("Internal server error");
            }
        })
    }

    // signup request
    else if (pathName === "/signup" && method === "GET") {

        try {
            const data = await fs.readFile("./public/html/signup.html");
            res.writeHead(200, { "Content-type": "text/html" });
            res.end(data);
        } catch (err) {
            res.writeHead(500);
            res.end("error loading signup page");
        }

    }
    else if (pathName === "/signup" && method === "POST") {

        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        })

        req.on("end", () => {
            const data = new URLSearchParams(body)

            const username = data.get("username")
            const email = data.get("email")
            const password = data.get("password")
            check_addData(username, email, password, res)
        })
    }

    //logout
    else if (pathName === "/logout" && method === "GET") {
        const cookies = req.headers.cookie;
        // console.log(cookies)
        const parsCookies = Object.fromEntries(cookies.split("; ").map(c => c.split("=")))
        const sessionId = parsCookies.sessionId;
        delete sessions[sessionId]
        res.writeHead(302, {
            "set-Cookie": "sessionId=; Max-Age = 0",
            "location": "/login"
        })
        return res.end();
    }

    //analyze
    else if (pathName === "/analyze" && method === "POST") {
        const session = isAuthentication(req, res);
        if (!session) {
            return
        }
        let body = ""

        req.on("data", (chunk) => {
            body += chunk.toString();
        })

        req.on("end", async () => {
            const data = new URLSearchParams(body)
            const folderPath = data.get("path");
            console.log("folder path", folderPath);
            const validPath = validatePath(folderPath);

            if (!validPath) {
                res.writeHead(400, { "constent-type": "text/plain" });
                return res.end("invalid path");
            }

            const result = await structure(validPath);

            session.lastStructure = result;
            res.writeHead(302, {
                "Location": "/search-structure"
            });
            res.end();
        })
    }

    //search-structure
    else if (pathName === "/search-structure" && method === "GET") {
        const session = isAuthentication(req, res);
        if (!session) {
            return
        }
        try {
            let searchFile = await fs.readFile("./public/html/searchFile.html", "utf-8");
            let userFile = await fs.readFile("./data/users.json", "utf-8");
            let users = JSON.parse(userFile)
            // console.log(users)
            let user = users.find(e => e.email === session.email);
            let resultData = "";

            if (session.lastStructure) {

                const structureData = session.lastStructure;

                const tree = buildTree(structureData.paths);

                resultData =
                    `📁Total Folders: ${structureData.folders}\n` +
                    `📄Total Files: ${structureData.files}\n\n` +
                    tree;

            } else {
                resultData = "No structure analyzed yet.";
            }
            const time = Math.floor((session.expireAt - Date.now()) / (1000 * 60));
            searchFile = searchFile.replace("{{result}}", resultData);
            // console.log(user);

            searchFile = searchFile.replace("{{username}}", user.username)
            searchFile = searchFile.replace("{{expiry}}", time)
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(searchFile);
        }
        catch (err) {
            res.writeHead(500, { "Content-type": "text/plain" });
            return res.end("error loding dashboard page")
        }
    }
    else if (pathName === "/search-structure" && method === "POST") {
        const session = isAuthentication(req, res);

        if (!session) {
            return;
        }

        if (!session.lastStructure) {
            res.writeHead(400, { "content-type": "text/plain" });
            return res.end("analyze the folder");
        }

        let body = "";

        req.on("data", chunk => body += chunk.toString());
        req.on("end", () => {
            const data = new url.URLSearchParams(body);
            const search = data.get("filename");
            const path = session.lastStructure.paths.filter(p => p.toLowerCase().includes(search.toLowerCase()));

            if (path.length === 0) {
                res.writeHead(400, { "Content-type": "text/plain" });
                return res.end("file not found! try wide search");
            }

            let response = "found:\n";

            path.forEach(p => {
                response += `path: ${p}\n`;
                response += steps(p);
            });
            res.writeHead(200, { "Content-type": "text/plain" });
            res.end(response);
        })
    }

    //help
    else if (pathName === "/help" && method === "GET") {
        let session = isAuthentication(req, res);
        if (!session) {
            return;
        }

        try {

            let helpPage = await fs.readFile("./public/html/help.html", "utf-8");
            let userFile = await fs.readFile("./data/users.json", "utf-8");
            let users = JSON.parse(userFile)
            // console.log(users)
            let user = users.find(e => e.email === session.email);
            // console.log(user);
            const time = Math.floor((session.expireAt - Date.now()) / (1000 * 60));
            helpPage = helpPage.replace("{{username}}", user.username)
            helpPage = helpPage.replace("{{expiry}}", time)
            res.writeHead(200, { "content-type": "text/html" });
            res.end(helpPage);
        } catch (err) {
            res.writeHead(500, { "content-type": "text/plain" });
            res.end("error loading help page")
        }
    }

    //chat
    else if (pathName === "/chat" && method === "POST") {
        let session = isAuthentication(req, res);
        if (!session) {
            return;
        }
        let body = "";

        req.on("data", chunk => body += chunk.toString());
        req.on("end", () => {
            const data = new URLSearchParams(body);
            console.log(data)
            const question = data.get("question");
            console.log(question)
            const answer = responseAnswer(question);
            console.log(answer)
            res.writeHead(200, { "content-type": "text/plain" });
            res.end(answer);
        })
    }

    //contact us
    else if (pathName === "/contact" && method === "GET") {
        const session = isAuthentication(req, res);
        if (!session) return;

        try {
            let contactPage = await fs.readFile("./public/html/contact.html", "utf-8");

            let userFile = await fs.readFile("./data/users.json", "utf-8");
            let users = JSON.parse(userFile);

            let user = users.find(e => e.email === session.email);

            if (!user) {
                res.writeHead(404, { "content-type": "text/plain" });
                return res.end("User not found");
            }

            const time = Math.max(0, Math.floor((session.expireAt - Date.now()) / (1000 * 60)));

            contactPage = contactPage.replace("{{username}}", user.username);
            contactPage = contactPage.replace("{{expiry}}", time);

            res.writeHead(200, { "content-type": "text/html" });
            res.end(contactPage);

        } catch (err) {
            res.writeHead(500, { "content-type": "text/plain" });
            res.end("Error loading contact page");
        }
    }
    else if (pathName === "/contact" && method === "POST") {
        let session = isAuthentication(req, res);
        if (!session) {
            return;
        }
        try {
            let body = "";
            req.on("data", chunk => {
                body += chunk.toString();
            });
            req.on("end", async () => {

                const data = new URLSearchParams(body);

                const name = data.get("name");
                const email = data.get("email");
                const message = data.get("message");

                if (!name || !email || !message) {
                    res.writeHead(400);
                    return res.end("all fields are required");
                }

                const newContact = {
                    name, email, message, createdAt: new Date()
                };


                let contacts = [];

                try {
                    const fileData = await fs.readFile("./data/contacts.json", "utf-8");
                    contacts = JSON.parse(fileData);
                } catch (err) {
                    contacts = [];
                }

                contacts.push(newContact);

                await fs.writeFile("./data/contacts.json", JSON.stringify(contacts, null, 2));

                res.writeHead(302, { "location": "/home" });
                res.end();
            });
        } catch (err) {
            res.writeHead(500, { "contant-type": "text/plain" });
            res.end("internal server error");
        }

    }

    //css
    else if (pathName.startsWith("/css/") && method === "GET") {
        try {
            const filePath = "./public" + pathName;
            const css = await fs.readFile(filePath);

            res.writeHead(200, { "Content-Type": "text/css" });
            return res.end(css);

        } catch (err) {
            res.writeHead(404);
            return res.end("CSS Not Found");
        }
    }

    else {
        res.writeHead(200, { "Content-type": "text/plain" });
        res.end("page not found");
    }

}).listen(port, () => {
    console.log(`server is running on http://localhost:${port}`)
});