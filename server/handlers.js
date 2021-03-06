var axios = require('axios');
var path = require('path');
var xmlParser = require('xml2js');
var config = require('./config.js');
var utils = require('./utils');
var User = require('../database/models/user.js');
var formidable = require('formidable');
var wsClient = require('websocket').client;
var fs = require('fs');
var streamBuffers = require('stream-buffers');
var jwt = require('jwt-simple');

// @todo: 'public' is a reserved keyword. Consider refactoring.
var public = path.join(__dirname + '/../public/');

var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
var randomID = function(length) {
  var text = '';
  for (var i = 0; i < length; i++) {
    text += possible.charAt( Math.floor(Math.random() * possible.length) );
  }
  return text;
};

// var ws = new wsClient();
var count = 0, wsCount = 0;
// var audioStream = new formidable.IncomingForm();
// var filename, fromLang, toLang, response;

// audioStream.on('error', function (error) {
//   console.log(error);
//   console.log('Error parsing file for transcription.');
// });

// audioStream.on('fileBegin', function (name, file) {
//   console.log('Starting upload...');
//   file.path = filename;
//   console.log('saved to:', file.path);
// });

// audioStream.on('end', function () {
//   // Get auth token
//   var query = `?Subscription-Key=${process.env.TRANSCRIBER_KEY}`;

//   axios.post(process.env.TRANSCRIBER_AUTH_URL + query)
//   .then(({data}) => {
//     // Hook up the necessary websocket events for sending audio and processing the response.
//     // Language is set in the query string as 'from=' and 'to='
//     var transcriptionURL = process.env.TRANSCRIBER_SERVICE_URL + `?api-version=1.0&from=${fromLang}&to=${toLang}`;

//     // Socket for connecting to the speech translate service.
//     var ws = new wsClient();

//     // Event for connection failure.
//     ws.on('connectFailed', function (error) {
//       console.log('Initial connection failed: ' + error.toString());
//     });

//     // Event for connection success.
//     ws.on('connect', function (connection) {
//       var wsNum = wsCount++;
//       console.log('ws   ', wsNum, '--> Websocket client connected');

//       // Process message that is returned.
//       connection.on('message', processMessage);

//       connection.on('close', function (reasonCode, description) {
//         console.log('ws   ', wsNum, '<-- Connection closed: ' + description);
//         // fs.unlink(filename, () => console.log('ws   ', wsNum, ': File removed'));
//       });

//       connection.on('error', function (error) {
//         console.log('ws   ', wsNum, '<-- Connection error: ' + error.toString());
//         // fs.unlink(filename, () => console.log('ws   ', wsNum, ': File removed'));
//       });

//       // Send audio file to the websocket endpoint.
//       sendData(connection, filename);
//     });

//     // Connect to the service.
//     ws.connect(transcriptionURL, null, null, {Authorization: 'Bearer ' + data});
//     // ws.close();
//   })
//   .catch(error => {
//     console.log(error);
//     console.log('Error getting auth token for transcription');
//   });
// });


// function processMessage(message) {
//   // result has two properties we care about:
//   //   - recognition: speech-to-text, not translated.
//   //   - translation: speech-to-text, translated.
//   var result = JSON.parse(message.utf8Data);
//   console.log(result.translation);
//   response.end(result.translation);
// };



// function sendData(connection, filename) {
//   var num = count++;
//   console.log('send ', num, '--> Send data');
//   // the streambuffer will raise the 'data' event based on the frequency and chunksize
//   var myReadableStreamBuffer = new streamBuffers.ReadableStreamBuffer({
//     frequency: 100,   // in milliseconds.
//     chunkSize: 32000  // 32 bytes per millisecond for PCM 16 bit, 16 khz, mono.  So we are sending 1 second worth of audio every 100ms
//   });

//   // read the file and put it to the buffer
//   myReadableStreamBuffer.put(fs.readFileSync(filename));

//     // silence bytes.  If the audio file is too short after the user finished speeaking,
//     // we need to add some silences at the end to tell the service that it is the end of the sentences
//     // 32 bytes / ms, so 3200000 = 100 seconds of silences
//   myReadableStreamBuffer.put(new Buffer(3200000));

//   // no more data to send
//   myReadableStreamBuffer.stop();

//   // send data to underlying connection
//   myReadableStreamBuffer.on('data', function (data) {
//     connection.sendBytes(data);
//   });

//   myReadableStreamBuffer.on('end', function () {
//     console.log('send ', num, '<-- All data sent, closing connection');
//     connection.close(1000);
//   });
// };



var translationQueue = [];

var worker = function() {
  if (translationQueue.length != 0) {
    var func = translationQueue.shift();
    func(worker);
  } else {
    setTimeout(worker, 3000);
  }
};

// worker();


module.exports = {

  index: (req, res) => {
    res.sendFile(public + 'index.html');
  },

  login: (req, res) => {
    User.newUser(req.body.userID, req.body.tokenPayload);
    res.end();
  },

  translate: (req, res) => {
    var {text, fromLang, toLang} = req.body;
    utils.translateText(text, fromLang, toLang)
    .then(({data}) => {
      xmlParser.parseString(data, function (error, translatedText) {
        if (error) {
          console.log('Error parsing XML.');
          console.log(error);
        } else {
          res.send(translatedText['string']['_']);
        }
      })
    })
    .catch((error) => {
      console.log('Error serving translate request.');
      console.log(error);
    });
  },

  authenticate: (req, res, next) => {
    try {
      let token = req.body.token || req.header('x-access-token').split(' ')[1];
      let payload = jwt.decode(token, process.env.AUTH0_SECRET, 'RS256');
      req.body.tokenPayload = payload;
      req.body.userID = payload.user_id.split('|')[1];
      next();
    } catch (e) {
      console.log('Warning: Token from client has expired, access denied');
      res.sendStatus(401);
    }
  },

  getRating: (req, res) => {
    User.getRatingById(req.body.userID)
    .then((rating) => {
      res.send(rating);
    })
    .catch((err) => {
      console.error('Failed to get rating!', err);
      res.sendStatus(500);
    });
  },

  getFriends: (req, res) => {
    User.getFriendsById(req.body.userID)
    .then((friends) => {
      res.send(friends);
    })
    .catch((err) => {
      console.error('Failed to get friends!', err);
      res.sendStatus(500);
    });
  },

  getData: (req, res) => {
    User.getDataById(req.body.userID)
    .then((data) => {
      res.send(data);
    })
    .catch((err) => {
      console.error('Failed to get metrics data!', err);
      res.sendStatus(500);
    });
  },

  getPublicId: (req, res) => {
    User.getPublicId(req.body.userID)
    .then((data) => {
      res.send(data);
    })
    .catch((err) => {
      console.error('Failed to get public id!', err);
      res.sendStatus(500);
    });
  },

  updateAvatar: (req, res) => {
    User.updateAvatar(req.body.userID, req.body.imageURL)
    .then((user) => {
      res.status(202).send(user.data.imageURL);
    })
    .catch((err) => {
      console.error('Failed to update avatar!', err);
      res.sendStatus(500);
    });
  },

  addFriend: (req, res) => {
    User.addFriendByPublicId(req.body.userID, req.body.friendId)
    .then(() => {
      res.status(201).send(req.body.friendId);
    })
    .catch((err) => {
      console.error('Failed to add friend!', err);
      res.sendStatus(500);
    });
  },

  updateRating: (req, res) => {
    User.updateRating(req.body.partnerId, req.body.votes)
    .then((user) => {
      res.status(202).send(req.body.votes);
    })
    .catch((err) => {
      console.error('Failed to update rating!', err);
      res.sendStatus(500);
    })
  },

  // Process, transcribe, and translate video chat audio file that client is trying to upload.
  // Streams audio to translation service, gets translated text back.
  // Triggered by toggling button on video page (from false to true), speaking into the mic, then toggling the button again (from true to false).
  // Client-side code is in /src/pages/video/components/VideoStream.vue.
  transcribe: (req, res) => {
    var audioStream = new formidable.IncomingForm();
    var wsNum = wsCount++;
    var [fromLang, toLang] = req.params.fromLang_toLang.split('_');
    var filename = __dirname + `/uploads/${randomID(20)}.wav`;
    // setTimeout(fs.unlink, 120000, filename, () => console.log('File Removed'));

    audioStream.on('error', function (error) {
      console.log(error);
      console.log('Error parsing file for transcription.');
    });

    audioStream.on('fileBegin', function (name, file) {
      console.log('Starting upload...');
      file.path = filename;
      console.log('saved to:', file.path);
    });

    audioStream.on('end', function () {
      // Get auth token
      var query = `?Subscription-Key=${process.env.TRANSCRIBER_KEY}`;

      axios.post(process.env.TRANSCRIBER_AUTH_URL + query)
      .then(({data}) => {
        // This is the file uploaded by the client.
        var file = filename;



        // Hook up the necessary websocket events for sending audio and processing the response.
        // Language is set in the query string as 'from=' and 'to='
        var transcriptionURL = process.env.TRANSCRIBER_SERVICE_URL + `?api-version=1.0&from=${fromLang}&to=${toLang}`;

        // Socket for connecting to the speech translate service.
        var ws = new wsClient();

        // Event for connection failure.
        ws.on('connectFailed', function (error) {
          console.log('Initial connection failed: ' + error.toString());
        });

        // Event for connection success.
        ws.on('connect', function (connection) {
          // console.log('Websocket client connected');
          console.log('ws   ', wsNum, '--> Websocket client connected');

          // Process message that is returned.
          connection.on('message', processMessage);

          connection.on('close', function (reasonCode, description) {
            // console.log('Connection closed: ' + description);
            console.log('ws   ', wsNum, '<-- Connection closed: ' + description);
            if (!res.headersSent) {
              console.log('close: res end');
              res.end();
            }
          });

          connection.on('error', function (error) {
            // console.log('Connection error: ' + error.toString());
            console.log('ws   ', wsNum, '<-- Connection error: ' + error.toString());
            if (!res.headersSent) {
              console.log('error: res end');
              res.end();
            }
          });

          // Send audio file to the websocket endpoint.
          sendData(connection, file);
          // translationQueue.push(sendData.bind(this, connection, file));
        });

        // Connect to the service.
        ws.connect(transcriptionURL, null, null, {Authorization: 'Bearer ' + data});
      })
      .catch(error => {
        console.log(error);
        console.log('Error getting auth token for transcription');
      });
    });

    audioStream.parse(req);

    // ========================================================================
    // == Helper functions. Will move to utils.js =============================
    // ========================================================================
    // Process the response from the service
    function processMessage(message) {
      // result has two properties we care about:
      //   - recognition: speech-to-text, not translated.
      //   - translation: speech-to-text, translated.
      var result = JSON.parse(message.utf8Data);
      if (!res.headersSent) {
        console.log('processMessage: res end');
        res.end(result.translation);
      }
    };

    // load the file and send the data to the websocket connection in chunks
    function sendData(connection, filename, callback) {
      var num = count++;
      console.log('send ', num, '--> Send data');
      // the streambuffer will raise the 'data' event based on the frequency and chunksize
      var myReadableStreamBuffer = new streamBuffers.ReadableStreamBuffer({
        frequency: 100,   // in milliseconds.
        chunkSize: 32000  // 32 bytes per millisecond for PCM 16 bit, 16 khz, mono.  So we are sending 1 second worth of audio every 100ms
      });

      // read the file and put it to the buffer
      myReadableStreamBuffer.put(fs.readFileSync(filename));

        // silence bytes.  If the audio file is too short after the user finished speeaking,
        // we need to add some silences at the end to tell the service that it is the end of the sentences
        // 32 bytes / ms, so 3200000 = 100 seconds of silences
      myReadableStreamBuffer.put(new Buffer(3200000));

      // no more data to send
      myReadableStreamBuffer.stop();

      // send data to underlying connection
      myReadableStreamBuffer.on('data', function (data) {
        connection.sendBytes(data);
      });

      myReadableStreamBuffer.on('end', function () {
        console.log('send ', num, '<-- All data sent, closing connection');
        connection.close(1000);
        // callback();
      });
    }
  }
};