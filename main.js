const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const Menu = electron.Menu;
const path = require('path');
const os = require('os');
const autoUpdater = electron.autoUpdater;
//electron.crashReporter.start();

var platform = os.platform() + '_' + os.arch();
var version = app.getVersion();

var mainWindow = null;
var procStarted = false;
var subpy = null;
var mainAddr;
var restarting = false;

try {
  autoUpdater.setFeedURL('https://pokemon-go-updater.mike.ai/update/'+platform+'/'+version);
} catch (e) {console.log(e)}

autoUpdater.on('update-downloaded', function(){
  mainWindow.webContents.send('update-ready');
});

try {
  autoUpdater.checkForUpdates();
} catch (e) {}

// Setup menu bar
var template = [{
    label: "Application",
    submenu: [{
        label: "About Application",
        selector: "orderFrontStandardAboutPanel:"
    }, {
        type: "separator"
    }, {
        label: "Quit",
        accelerator: "Command+Q",
        click: function() {
            app.quit();
        }
    }]
}, {
    label: "Edit",
    submenu: [{
        label: "Undo",
        accelerator: "CmdOrCtrl+Z",
        selector: "undo:"
    }, {
        label: "Redo",
        accelerator: "Shift+CmdOrCtrl+Z",
        selector: "redo:"
    }, {
        type: "separator"
    }, {
        label: "Cut",
        accelerator: "CmdOrCtrl+X",
        selector: "cut:"
    }, {
        label: "Copy",
        accelerator: "CmdOrCtrl+C",
        selector: "copy:"
    }, {
        label: "Paste",
        accelerator: "CmdOrCtrl+V",
        selector: "paste:"
    }, {
        label: "Select All",
        accelerator: "CmdOrCtrl+A",
        selector: "selectAll:"
    }]
},
{
    label: "Tools",
    submenu: [
      {
        label: "Refresh",
        accelerator: "CmdOrCtrl+R",
        click(item, focusedWindow) {
          if (focusedWindow) focusedWindow.reload();
        }
      },
      {
        label: 'Toggle Developer Tools',
        accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        click(item, focusedWindow) {
          if (focusedWindow)
            focusedWindow.webContents.toggleDevTools();
        }
      }
    ]
}
];


app.on('window-all-closed', function() {
  if (restarting) {
    return;
  }
  if (subpy && subpy.pid) {
    killProcess(subpy.pid);
  }
  app.quit();
});

app.on('ready', function() {

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  setupMainWindow();
});

function setupMainWindow() {
  restarting = false;

  mainWindow = new BrowserWindow({width: 800, height: 600, minWidth: 700, minHeight: 500});
  mainWindow.loadURL('file://' + __dirname + '/login.html');

  mainWindow.on('closed', function() {
    mainWindow = null;
    if (subpy && subpy.pid) {
      killProcess(subpy.pid);
    }
  });
}

function logData(str){
  console.log(str);
  // if(mainWindow){
  //   mainWindow.webContents.executeJavaScript('console.log(unescape("'+escape(str)+'"))');
  // }
}

function killProcess(pid) {
  try {
    process.kill(-pid, 'SIGINT');
    process.kill(-pid, 'SIGTERM');
  } catch (e) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (e) {}
  }
}

ipcMain.on('logout', function(event, auth, code, lat, long, opts) {
  restarting = true;
  if (procStarted) {
    logData('Killing Python process...');
    if (subpy && subpy.pid) {
      killProcess(subpy.pid);
    }
  }
  procStarted = false;
  mainWindow.close();
  setupMainWindow();
});

ipcMain.on('startPython', function(event, auth, code, lat, long, opts) {
  if (!procStarted) {
    logData('Starting Python process...');
    startPython(auth, code, lat, long, opts);
  }
  procStarted = true;
});

ipcMain.on('getServer', function(event) {
  event.sender.send('server-up', mainAddr);
});

ipcMain.on('installUpdate', function(event) {
  autoUpdater.quitAndInstall();
});

function startPython(auth, code, lat, long, opts) {

  mainWindow.loadURL('file://' + __dirname + '/main.html');
  //mainWindow.openDevTools();

  // Find open port
  var portfinder = require('portfinder');
  portfinder.getPort(function (err, port) {

    logData('Got open port: ' + port);

    // Run python web server
    var cmdLine = [
      './example.py',
      '--auth_service',
      auth,
      '--location=' +
        parseFloat(lat).toFixed(7) + ',' + parseFloat(long).toFixed(7),
      '--auto_refresh',
      '5',
      '--port',
      port,
      '--parent_pid',
      process.pid
    ];

    if (auth == 'ptc' && opts.username && opts.password) {
      cmdLine.push('--username');
      cmdLine.push(opts.username);
    } else {
      cmdLine.push('--token');
      cmdLine.push(code);
    }

    // Add options
    if (opts.show_gyms) {
      cmdLine.push('--display-gym');
    }

    if (opts.show_pokestops) {
      cmdLine.push('--display-pokestop');
      if (opts.only_stops_with_lures) {
        cmdLine.push('--onlylure');
      }
    }

    if (opts.pokemon_ids && opts.pokemon_ids != '') {
      if (opts.filter_pokemon == 'include' || opts.filter_pokemon == 'exclude') {
        if (opts.filter_pokemon == 'include') {
          cmdLine.push('--only');
        }
        else {
          cmdLine.push('--ignore');
        }
        cmdLine.push(opts.pokemon_ids);
      }
    }

    cmdLine.push('--step-limit');
    if (opts.radius && opts.radius != '') {
      cmdLine.push(opts.radius);
    } else {
      cmdLine.push('7');
    }

    // console.log(cmdLine);
    logData('Maps path: ' + path.join(__dirname, 'map'));
    logData('python ' + cmdLine.join(' '))

    var pythonCmd = 'python';
    if (os.platform() == 'win32') {
      pythonCmd = path.join(__dirname, 'pywin', 'python.exe');
    }

    subpy = require('child_process').spawn(pythonCmd, cmdLine, {
      cwd: path.join(__dirname, 'map'),
      detached: true
    });

    subpy.stdout.on('data', (data) => {
      logData(`Python: ${data}`);
      mainWindow.webContents.send('pythonLog', {'msg': `${data}`});
    });
    subpy.stderr.on('data', (data) => {
      logData(`Python: ${data}`);
      mainWindow.webContents.send('pythonLog', {'msg': `${data}`});
    });

    // Pass password into new process
    if (auth == 'ptc' && opts.password) {
      setTimeout(function() {
        console.log("Logging in to PTC");
        subpy.stdin.write(opts.password);
        subpy.stdin.write("\n");
      }, 1500);
    }

    var rq = require('request-promise');
    mainAddr = 'http://localhost:' + port;

    var openWindow = function(){
      mainWindow.webContents.send('server-up', mainAddr);
      mainWindow.webContents.executeJavaScript(
        'serverUp("'+mainAddr+'")');
      mainWindow.on('closed', function() {
        mainWindow = null;
        if (subpy && subpy.pid) {
          killProcess(subpy.pid);
        }
        procStarted = false;
      });
    };

    var startUp = function(){
      rq(mainAddr)
        .then(function(htmlString){
          logData('server started!');
          openWindow();
        })
        .catch(function(err){
          //console.log('waiting for the server start...');
          startUp();
        });
    };

    startUp();

  });

};
