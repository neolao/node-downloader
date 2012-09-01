var fs                  = require("fs"),
    path                = require("path"),
    charm               = require("charm")(),
    feedsConfigPath     = path.normalize(__dirname+"/../config/feeds.json"),
    temporaryPath       = path.normalize(__dirname+"/../tmp"),
    downloads           = [],
    maxDownloadCount    = 1,
    delayActivated      = false,
    delayCountDown      = 0,
    delayInterval;


/**
 * The configuration file is loaded
 *
 * @param   Object      error       Error object
 * @param   String      data        The file content
 */
function onReadConfigFile(error, data)
{
    // Error handler
    if (error) {
        console.error("Could not open file: %s", error.path);
        process.exit(1);
    }

    // Parse the data in JSON
    var feeds = JSON.parse(data),
        count = feeds.length,
        feed, index;

    // Check each feed and download items
    for (index = 0; index < count; index++) {
        feed = feeds[index];
        checkFeed(feed);
    }
}

/**
 * Check a feed and download items
 *
 * @param   Object      feed        The feed informations
 */
function checkFeed(feed)
{
    var url         = require("url"),
        feedparser  = require("feedparser"),
        parser      = new feedparser();

    // Build the feed URL
    var feedUrlObject = url.parse(feed.url);
    if (feed.auth) {
        feedUrlObject.auth = feed.auth.login+":"+feed.auth.password;
    }
    var feedUrl = url.format(feedUrlObject);

    // Load and parse the feed URL
    parser.parseUrl(feedUrl, function(error, meta, articles)
    {
        // Error handler
        if (error) {
            //console.error("Parse error: %s", error.message);
            return;
        }
        
        // Download all links
        articles.forEach(function(article)
        {
            // Build file URL
            var fileUrlObject = url.parse(article.link);
            if (feed.auth) {
                fileUrlObject.auth = feed.auth.login+":"+feed.auth.password;
            }
            var fileUrl = url.format(fileUrlObject);

            // Start the download
            downloadFile(fileUrl, feed.destination);
        });
    });
}

/**
 * Download a file
 *
 * @param   String      url             URL of the file
 * @param   String      destination     Directory path
 */
function downloadFile(url, destination)
{
    var http            = require("http"),
        request         = require("request"),
        urlModule       = require("url"),
        querystring     = require("querystring"),
        fs              = require("fs"),
        urlInfo,
        fileName,
        destinationFile,
        httpClient,
        fileStat,
        downloadProcess;

    // Find the file name
    urlInfo         = urlModule.parse(url);
    fileName        = urlInfo.pathname.split("/").pop();
    fileName        = querystring.unescape(fileName);

    // Build the destination file path
    destinationFile = destination+"/"+fileName;

    // Add the download to the queue if the destination file does not exists
    try {
        fileStat = fs.lstatSync(destinationFile);
        if (fileStat.isFile()) {
            return;
        }
    } catch (error) {

    }
    downloadProcess = {
        url: url,
        path: destinationFile,
        fileName: fileName,
        total: 0,
        progress: 0,
        percent: "0%",
        pending: true,
        finished: false
    };
    downloads.push(downloadProcess);

    resumeQueue();
}

/**
 * Resume the queue
 */
function resumeQueue()
{
    var http = require("http"),
        downloadCount = downloads.length,
        activatedDownloadCount = 0,
        downloadProcess,
        index;

    // If the max download count is reached, then do nothing
    for (index = 0; index < downloadCount; index++) {
        downloadProcess = downloads[index];
        if (!downloadProcess.finished && !downloadProcess.pending) {
            activatedDownloadCount++;
        }
    }
    if (activatedDownloadCount >= maxDownloadCount) {
        return;
    }

    // Start a download
    // Find the first pending download
    downloadProcess = null;
    for (index = 0; index < downloadCount; index++) {
        if (!downloads[index].finished && downloads[index].pending) {
            downloadProcess = downloads[index];
            break;
        }
    }
    if (!downloadProcess) {
        waitDelay();
        return;
    }
    downloadProcess.pending = false;

    // Build the temporary destination file path
    destinationFileTemp = temporaryPath+"/"+downloadProcess.fileName+".tmp";

    httpClient = http.get(downloadProcess.url, function(response)
    {
        var stream = fs.createWriteStream(destinationFileTemp, {flags: "w", encoding: "binary"});

        downloadProcess.total = response.headers['content-length'];
        downloadProcess.progress = 0;

        // Append the data into the file
        response.on("data", function(chunk)
        {
            downloadProcess.progress += chunk.length;
            stream.write(chunk);
            downloadProcess.percent = Math.floor(downloadProcess.progress/downloadProcess.total*100)+"%";
        });

        // Close the file
        response.on("end", function()
        {
            stream.end();
            fs.rename(destinationFileTemp, downloadProcess.path);
            downloadProcess.finished = true;

            resumeQueue();
        });
    });
    httpClient.end();
}

/**
 * Wait a delay
 */
function waitDelay()
{
    delayActivated = true;
    delayCountDown = 60*60;
    downloads = [];

    delayInterval = setInterval(function()
    {
        delayCountDown--;
        if (delayCountDown > 0) {
            return;
        }

        clearInterval(delayInterval);
        delayActivated = false;

        // Load the configuration file again
        fs.readFile(feedsConfigPath, 'utf8', onReadConfigFile);
    }, 1000);
}

/**
 * Update the display
 */
function updateDisplay()
{
    var count = downloads.length,
        index, downloadProcess;

    // Clear the display
    charm.reset();

    // Show the delay message
    if (delayActivated) {
        charm.foreground("white").write("Waiting ... "+delayCountDown);
        return;
    }

    // If the download list is empty, then start the delay
    if (count === 0) {
        waitDelay();
        return;
    }

    // Show the title
    charm.foreground("yellow").write("Current downloads ("+count+"):\n");

    // Show the current downloads
    for (index = 0; index < count; index++) {
        downloadProcess = downloads[index];

        charm.foreground("white").write(downloadProcess.path+" ");
        if (downloadProcess.finished) {
            charm.foreground("green").write("finished\n");
        } else if (downloadProcess.pending) {
            charm.foreground("green").write("pending\n");
        } else {
            charm.foreground("green").write(downloadProcess.percent+"\n");
        }
        charm.foreground("white");

        // Limit the display to 10 processes
        if (index >= 10) {
            charm.write(".\n");
            charm.write(".\n");
            charm.write(".\n");
            break;
        }
    }
}



// Load the configuration file
fs.readFile(feedsConfigPath, 'utf8', onReadConfigFile);

// Initialize the display
charm.pipe(process.stdout);
charm.reset();
setInterval(updateDisplay, 1000);
