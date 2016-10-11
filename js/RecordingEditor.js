// import bus from 'bus'
// import VueDialog from 'component/vue-dialog/main.js'

// 以下被注释的代码应该能够解决safari上面的getUserMedia和createMediaStreamSource的问题
// 在editor/index/record里有源码可以测试，我使用recorder.js可以顺利执行
// 但是我在插入到此处后，recorder屡次为空
// 应该解决了这个问题就好
// 示例中我也使用了creatMediaStreamSource和getUserMedia方法,暂时显示没有问题。
// ——钟恒 2016.9.25
// import './lib/polyfill/flashGetUserMedia.js'
// let div = document.createElement('div')
// div.id = 'flashGetUserMedia'
// document.body.appendChild(div);
// window.flashGetUserMedia.init({swfPath: '/static/flashGetUserMedia.swf', force: false});

(function(window, undefined) {
var document = window.document,

  version = '0.0.1',

  audioContext,

  recorder,

  RecordingEditor = function(config) {
    return new RecordingEditor.prototype.init(config);
  };

RecordingEditor.checkMicrophone = function(callback) {
  // getUserMedia is not supportted in safari
  if(navigator.userAgent.indexOf('Safari') != -1 && navigator.userAgent.indexOf('Chrome') == -1) {
    callback(false, 'Safari浏览器暂不支持在线录音功能<br/>您可以使用Chrome浏览器<br/><a href="http://www.chromeliulanqi.com/">点击下载Chrome浏览器<a/>');
    return;
  }
  
  // getUserMedia
  navigator.getUserMedia = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);

  navigator.getUserMedia({
      audio: true
  }, ()=>{
    callback && callback(true)
  }, function(e){
    console.warn('No live audio input:' + e);
    bus.$emit('no-microphone');
    callback && callback(false, '无麦克风或麦克风被禁止</br>请启动麦克风并刷新重试');
  });
}
// bus.$on('check-microphone', RecordingEditor.checkMicrophone);

RecordingEditor.prototype = {
  version: version,

  // set prototype = {} need to give the constructor
  constructor: RecordingEditor,

  // insert the rootDOM to body by default
  $appendToElement: $('body'),  

  showRecordedArea: false,

  // default properties about canvas's layout and drawing
  canvasLeftOffset:      20,  // begin position of time line and audio wave  
  canvasRightOffset:     30,
  widthPreSecond_px:     15,
  pointsNumPreSecond:    1,
  timeUnit_s:            5,
  omittedSamplesNum:     256, // must be 2^n and <= 4096
  defaultLineWidth:      1,
  defaultFont:             '10px April',
  defaultStrokeStyle:      '#444',
  defaultHLStrokeStyle:    '#666',
  defaultTextFillStyle:    '#fff',
  defaultWaveStrokeStyle:  '#40cb90',
  modifiedWaveStrokeStyle: '#e74c3c', // color of inserted or replaced wave

  // default properties about duration limit
  durationLimit_s: 300,       // default recording duration limit(5 mins = 5 * 60 s)
  isExceedLimit: false,       // whether exceed duration limit
  isExceedLimit_temp: false,  // when exceed the duration limit and has selected area,
                              // need to change the state of record ctl, then will use this temp property

  // properties about loaded audio
  hasLoadedAudio:    false, 
  loadedAudioURL:    '', 

  // properties in the process of recording
  hasRecordedAudio:  false,
  isChanged:         false, // whether the recording has been changed
  isInsertOrReplace: false,
  existedBuffer:     '',
  restImgData:       '',
  newRestRightWidth: 0, // 无选区插入音频时，初步替换音轨，需要实时计算右侧剩余的宽度
  currentEvent:      undefined,
  unconvertEventsList:   undefined,
  eventsList:        {},
  samplesCount:      0,    // sample counts of the recorded audio
  duration:          0,

  // properties in the process of playing
  playBegin_ms: 0,

  // worker path for recorder's web worker
  WORKER_PATH: 'js/lib/recorder/RecorderWorker.js',
  // WORKER_PATH: 'static/js/lib/RecorderWorker.js',

  // RecordingEditor's state
  state: 'uninited',
  /* 
    state 
      uninited:                    组件尚未初始化(默认状态)
      initing:                     正在初始化
      loadedAudioProcessing:       加载音频处理中
      unavailable:                 浏览器不支持录音相关功能或麦克风未开启时组件为不可用状态
      available:                   组件处于可用状态(初始化完成后，为可用状态；组件不处于录音、播放相关等状态时，也为可用状态)
      recording:                   录音中
      recordingPauseProcessing:    录音暂停处理中(录音暂停时，需要进行音频的压缩等处理，指明该状态)
      recordingCompleteProcessing: 录音完成处理中(录音完成时，需要进行)
      playing:                     音频播放中
      reseting:                    组件重置中
  */
  /*
    与state对应的事件  
    event:
      stateChange:          组件状态发生改变时触发
      loadedAudioProcessed: 加载音频处理完成时触发
      inited:               初始化完成时触发
      micChecked:           麦克风检测完毕时触发
      recordingStarted:     录音开始时触发
      recordingPaused:      录音暂停时触发
      recordingCompleted:   录音完成时触发
      playingStarted:       音频播放时触发
      playingPaused:        音频播放暂停时触发
      playingEnded:         音频播放结束时触发（包括选区播放结束和非选区播放结束）
      reseted:              组件重置完毕时触发
   */
  
  init: function( config ) {
    var self = this;

    // extend(merge) the config to default properties
    $.extend(true, self, config);   
    
    self.initDOM();

    // goto stateListener and trigger stateChange after DOM inited
    // because the method of trigger/on/off is binded to the DOM element of this component
    self.stateLinstener();
    self.trigger('stateChange', [{newState: 'initing'}]);

    self.initRecorder();
    self.initAudioVisualizationArea();

    return self;
  },

  stateLinstener: function() {
    this.on('stateChange', this.stateChangeHandler.bind(this));
  },
  
  stateChangeHandler: function(event, data /* 参考格式 [{newState: 'initing', triggerEvent: 'eventName'}] */) {
    var self = this;

    var newState = data && data.newState;
    var triggerEvent = data && data.triggerEvent;

    if(newState) {
      self.state = newState;
    }

    if(triggerEvent) {
      self.trigger(triggerEvent);      
    }

    console.log('current state: ', newState);
    console.log('current event: ', triggerEvent);    

    // need to show recorder ctls when the state change
    // diff state has diff interaction
    self.showRecorderCtls();

    // 根据状态控制组件相应显示与交互的更新
    switch(newState) {
      case 'initing': 
        break;
      case 'unavailable': 
        self.$noMicrophone.addClass('show');
        break;
      case 'available': 
        self.$audioVisualizationArea.removeClass('disabled');
        break;
      case 'recording': 
      case 'recordingPauseProcessing': 
      case 'recordingCompleteProcessing': 
      case 'playing': 
        self.$audioVisualizationArea.addClass('disabled');
        break;
      default:
        break;
    } 
  },
  
  showRecorderCtls: function() {
    var self = this;
    
    // show ctls
    self.showRecordCtl();
    self.showPlayCtl();
    self.showCompleteCtl();
  },

  showRecordCtl: function() {
    var self = this;
    var state = self.state;
    
    self.$recordCtl.unbind('click');
    
    switch(state) {
      case 'available':
        // 提取超出时长限制和正常录音的公共操作
        self.$recordCtl
          .removeClass('record-pause waiting')
          .find('i').removeClass('icon-pause').addClass('icon-mic-1');

        if(self.isExceedLimit) {
          self.$recordCtl
            .removeClass('record-start')
            .addClass('disabled')
            .attr({'data-balloon': '超过录音时长限制', 'data-balloon-pos': 'down'});          
          return;
        }
        self.$recordCtl
          .removeClass('disabled')
          .addClass('record-start')
          .attr({'data-balloon': '开始录音', 'data-balloon-pos': 'down'})   
          .click(function() {
            // 当isExceedLimit_temp为true时，即已超出时长限制，
            // 但是因用户选区或者插入重录等操作，可以进行录制，还原该属性的值
            if(self.isExceedLimit_temp) {
              self.isExceedLimit_temp = false;              
            }
            self.startRecording();
          });
        break;
      case 'recording':
        self.$recordCtl
          .removeClass('record-start waiting disabled')
          .addClass('record-pause')
          .attr({'data-balloon': '暂停录音', 'data-balloon-pos': 'down'})          
          .click(function() {
            // 如果录音时长提示处于显示状态，则隐藏
            if(self.$durationLimit.hasClass('breath')) {
              // remove mask if it shows
              setTimeout(function() {
                self.$durationLimit.removeClass('breath');          
              }, 300);
            }
            self.pauseRecording();
          })
          .find('i').removeClass('icon-mic-1').addClass('icon-pause');
        break;
      case 'recordingPauseProcessing':
        self.$recordCtl
          .removeClass('record-start record-pause disabled')
          .addClass('waiting')
          .attr({'data-balloon': '录音处理中...', 'data-balloon-pos': 'down'});
        break;
      case 'loadedAudioProcessing':
        self.$recordCtl
          .removeClass('record-start record-pause disabled')
          .addClass('waiting')
          .attr({'data-balloon': '音频加载中...', 'data-balloon-pos': 'down'});
        break;
      default:
        self.$recordCtl.
          removeClass('record-start record-pause waiting')
          .addClass('disabled')
          .attr({'data-balloon': '当前状态无法录音', 'data-balloon-pos': 'down'});
        break;
    }
  },

  showPlayCtl: function() {
    var self = this;
    var state = self.state;

    self.$playCtl.unbind('click');

    switch(state) {
      case 'available':
        // 提取超出可播放和不可播放间的公共操作
        self.$playCtl
          .removeClass('audio-pause waiting')
          .find('i').removeClass('icon-pause').addClass('icon-play');
        
        if( !(self.hasLoadedAudio || self.hasRecordedAudio) ) {
          self.$playCtl
            .removeClass('audio-play')
            .addClass('disabled')
            .attr({'data-balloon': '暂无音频，无法播放', 'data-balloon-pos': 'down'});
          return;
        }
        self.$playCtl
          .removeClass('disabled')
          .addClass('audio-play')
          .attr({'data-balloon': '开始播放', 'data-balloon-pos': 'down'})
          .click(function() {
            self.playAudio();
          });
        break;
      case 'playing':
        self.$playCtl
          .removeClass('audio-play disabled waiting')
          .addClass('audio-pause')
          .attr({'data-balloon': '暂停播放', 'data-balloon-pos': 'down'})
          .click(function() {
            self.pauseAudio();
          })
          .find('i').removeClass('icon-play').addClass('icon-pause');
        break;
      case 'loadedAudioProcessing':
        self.$playCtl
          .removeClass('audio-play audio-pause disabled')
          .addClass('waiting')
          .attr({'data-balloon': '音频加载中...', 'data-balloon-pos': 'down'});
        break;
      default:
        self.$playCtl
          .removeClass('audio-play audio-pause waiting')
          .addClass('disabled')
          .attr({'data-balloon': '当前状态无法播放', 'data-balloon-pos': 'down'});
        break;
    }
  },

  showCompleteCtl: function() {
    var self = this;
    var state = self.state;

    self.$completeCtl.unbind('click');

    switch(state) {
      case 'available':
        // 当因用户操作导致录音时长为0时，则无法保存
        if(self.isChanged && self.duration == 0) {
          self.$completeCtl
            .addClass('disabled')
            .attr({'data-balloon': '音频长度为零，无法保存', 'data-balloon-pos': 'down'});
          return;
        }
        self.$completeCtl
          .removeClass('waiting disabled')
          .attr({'data-balloon': '完成录音', 'data-balloon-pos': 'down'})
          .click(function() {
            // VueDialog.confirm(
            //   '是否保存修改？', 
            //   (result) => {
            //     if(result) {
                  // self.hide();
                  self.completeRecording();
            //     }
            //   }, 
            //   {
            //     posRelativeTo: self.$completeCtl[0],
            //     pos: 'bottom'
            //   }
            // )
          });
        break;
      case 'recordingCompleteProcessing':
        self.$completeCtl
          .removeClass('disabled')
          .addClass('waiting')
          .attr({'data-balloon': '录音处理中...', 'data-balloon-pos': 'down'});
        break;
      case 'loadedAudioProcessing':
        self.$completeCtl
          .removeClass('disabled')
          .addClass('waiting')
          .attr('tooltips','音频加载中...');
        break;
      default: 
        self.$completeCtl
          .removeClass('waiting')
          .addClass('disabled')
          .attr({'data-balloon': '当前状态无法保存录音', 'data-balloon-pos': 'down'});
        break;
    }
  },

  initDOM: function() {
    var self = this;

    // append rootDOM($RecordingEditor) to $appendToElement
    self.rootDOM = self.$RecordingEditor = $('<div/>')
      .addClass('recording-editor')
      .appendTo(self.$appendToElement);

    // recorder ctls
    self.$recorderCtls = $('<div/>')
      .addClass('recorder-ctls')
      .appendTo(self.$RecordingEditor);

    // record ctl
    self.$recordCtl = $('<div/>')
      .addClass('recorder-ctl record record-start')
      .appendTo(self.$recorderCtls)
      .append($('<i/>').addClass('icon iconfont icon-mic-1'));

    // play ctl
    self.$playCtl = $('<div/>')
      .addClass('recorder-ctl audio audio-play')
      .appendTo(self.$recorderCtls)
      .append($('<i/>').addClass('icon iconfont icon-play'));

    // complete ctl
    self.$completeCtl = $('<div/>')
      .addClass('recorder-ctl record-complete')
      .appendTo(self.$recorderCtls)
      .append($('<i/>').addClass('icon iconfont icon-ok'));

    // audio visualization area 
    self.$audioVisualizationArea = $('<div/>')
      .addClass('audio-visualization-area')
      .appendTo(self.$RecordingEditor);

    // perfect-scroll plugin needs the child nodes of the specific element to be only one
    // so wrap the two canvas( time line canvas and audio wave canvas) in canvases
    var $canvases = $('<div/>').addClass('canvases').appendTo(self.$audioVisualizationArea);

    self.$timeLine  = $('<canvas/>')
      .addClass('time-line')
      .attr({'width':0, 'height': 20})
      .appendTo($canvases);

    self.$audioWave = $('<canvas/>')
      .addClass('audio-wave')
      .attr({'width':0, 'height': 65})
      .appendTo($canvases);
    
    self.$selectedArea = $('<div/>').addClass('selected-area').appendTo($canvases);

    self.$sliderBar = $('<div/>').addClass('slider-bar').appendTo($canvases);

    // recording duration limit mask layer and count down
    self.$durationLimit = $('<div/>').addClass('duration-limit')
      .appendTo(self.$RecordingEditor)
      .html('还可以录<span class="count-down">10</span>秒');

    self.$durationLimitCountDown = self.$durationLimit.find('span.count-down');

    // recorded area, include recorded audio, download links of wav file and amr file
    self.$recordedArea = $('<div/>')
      .addClass('recorded-area' + (self.showRecordedArea ? '' : ' hide'))
      .appendTo(self.$RecordingEditor);

    self.$recordedAudio = $('<audio/>')
      .addClass('recorded-audio')
      .attr('controls',true)
      .appendTo(self.$recordedArea);

    // no microphone warning
    self.$noMicrophone = $('<div/>')
      .addClass('no-microphone')
      .appendTo(self.$RecordingEditor)
      .html('<span>无麦克风或麦克风被禁止<br>请启动麦克风并刷新重试</span>');
  },

  initRecorder: function() { 
    var self = this;
    // audioContext init, userMedia init
    try {
      // shim
      window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;

      // safari dose not support the getUserMedia, give a warning hint
      if(navigator.userAgent.indexOf('Safari') != -1 && navigator.userAgent.indexOf('Chrome') == -1) {
        console.warn('Safari浏览器暂不支持在线录音功能。您可以尝试使用Chrome浏览器。点击下载Chrome浏览器http://www.chromeliulanqi.com/');
      }

      navigator.getUserMedia = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);

      window.URL = window.URL || window.webkitURL || window.mozURL;

      audioContext = new AudioContext();
    }catch (e) {
      console.warn('Web audio API is not supported in this browser');
    }

    navigator.getUserMedia(
      {
        audio: true
      }, 
      function(stream) {
        var inputStream = audioContext.createMediaStreamSource(stream);
        recorder = new self.Recorder(inputStream, {}, self);
      }, 
      function(e){
        self.trigger('stateChange', [{newState: 'unavailable', triggerEvent: 'micChecked'}]);
      }
    );
  },

  // recorder 的内部实现机制
  Recorder: function(source, cfg, RecorderEditor){
    var self        = RecorderEditor, // self point to this/RecorderEditor
      self_recorder = this,
      
      config        = cfg || {},
      bufferLen     = config.bufferLen || 4096,
      worker        = new Worker(config.workerPath || self.WORKER_PATH),

      // recoding related variables
      recording = false,
      currCallback,
      restRightWidth = 0,
      positionPercent = 0,
      selectedPercent = 0;

    this.context = source.context;
    this.node = this.context.createScriptProcessor(bufferLen, 2, 2);
    source.connect(this.node);
    this.node.connect(this.context.destination);

    worker.postMessage({
      command: 'init',
      config: {
        sampleRate: this.context.sampleRate,
        durationLimit_s: self.durationLimit_s
      }
    });

    // 待注释或删除 
    // 计算每次处理音频的时间
    var prev = new Date().getTime();
    this.node.onaudioprocess = function(e){
      if (!recording) return;

      // 待注释或删除
      var now = new Date().getTime();
      console.log('audio processing time', now - prev);
      prev = now;
      
      // 绘制音轨
      self.drawAudioWave(e.inputBuffer, positionPercent, selectedPercent, restRightWidth);

      worker.postMessage({
        command: 'record',
        currentEvent: self.currentEvent,
        buffer: [
          e.inputBuffer.getChannelData(0),
          e.inputBuffer.getChannelData(1)
        ]
      });

      // 重置currentEvent
      self.currentEvent = undefined;
    }

    // ******从服务器加载时，需要传递eventsList
    // 从服务器加载的音频文件, 将其放入音频流中
    this.loadAudio = function(loadedBuffer, unconvertEventsList) {
      worker.postMessage({
        command: 'loadAudio',
        unconvertEventsList: unconvertEventsList,
        buffer: [
          loadedBuffer.getChannelData(0),
          loadedBuffer.getChannelData(0)
        ]
      });
    }

    this.record = function(positionPercentTemp, selectedPercentTemp, restRightWidthTemp){
      recording = true;

      positionPercent = positionPercentTemp || 0;
      selectedPercent = selectedPercentTemp || 0;
      restRightWidth  = restRightWidthTemp  || 0;

      console.log(positionPercent, selectedPercent, restRightWidth);

      // 点击开始录音时，设定本次录音插入的位置及选区的大小
      worker.postMessage({
        command: 'setVariable',
        positionPercent: positionPercent,
        selectedPercent: selectedPercent
      });
    }

    this.stop = function(){
      recording = false;
    }

    this.clear = function(){
      worker.postMessage({ command: 'clear' });
    }

    this.getBuffer = function(cb) {
      currCallback = cb || config.callback;
      worker.postMessage({ command: 'getBuffer' })
    }

    this.exportWAV = function(cb, type){
      currCallback = cb || config.callback;
      type = type || config.type || 'audio/wav';
      if (!currCallback) throw new Error('Callback not set');
      worker.postMessage({
        command: 'exportWAV',
        type: type
      });
    }

    // processing with web worker message
    worker.onmessage = function(e){
      switch(e.data.command){
        case 'durationLimit':
          self_recorder.handleDurationLimit(e.data);
          break;
        case 'exportWAV':
          self_recorder.handleExportWAV(e.data);
          break;
        case 'getBuffer':
          self_recorder.handleGetBuffer(e.data);
          break;
        default:
          break;
      }
    }

    this.handleDurationLimit = function(data) {
      var restDuration_s = data.restDuration_s;
      
      self.$durationLimit.addClass('breath');
      self.$durationLimitCountDown.html(restDuration_s);
      
      if(restDuration_s == 0) {
        self.isExceedLimit = true;

        // change record ctl
        self.$recordCtl.click();

        // clear exceeded audio wave
        var audioWaveWidthLimit = self.widthPreSecond_px * self.durationLimit_s
        var audioWaveWidth = self.$audioWave.data('waveWidth');
        // exceeded width
        var dValue = audioWaveWidth - audioWaveWidthLimit;

        if(dValue > 0) {
          var $audioWaveCanvas = self.$audioWave;
          var audioWaveCtx = $audioWaveCanvas[0].getContext('2d');
          var canvasHeight = $audioWaveCanvas.height(); 
          var halfHeight = canvasHeight / 2;

          audioWaveCtx.clearRect(audioWaveWidthLimit + self.canvasLeftOffset, 1, dValue, canvasHeight - 2);
          // middle line need to be redraw
          audioWaveCtx.strokeStyle = self.defaultHLStrokeStyle;
          audioWaveCtx.lineWidth = self.defaultLineWidth;
          audioWaveCtx.beginPath();
          audioWaveCtx.moveTo(audioWaveWidthLimit + self.canvasLeftOffset, halfHeight);
          audioWaveCtx.lineTo(audioWaveWidthLimit + self.canvasLeftOffset + dValue, halfHeight);
          audioWaveCtx.stroke();

          // update the audio wave's data and slider-bar
          $audioWaveCanvas.data('waveWidth', audioWaveWidthLimit);
          $audioWaveCanvas.data('beginX', $audioWaveCanvas.data('beginX') - dValue);
          self.$sliderBar.css('left', parseInt(self.$sliderBar.css('left')) - dValue); 
        }
      }
    }

    this.handleExportWAV = function(data) {
      self.unconvertEventsList = data.unconvertEventsList;
      self.eventsList          = data.eventsList;
      self.samplesCount        = data.samplesCount;
      
      // 待删除
      console.log(self.unconvertEventsList, self.eventsList, self.samplesCount, data.audioBlob)

      currCallback(data.audioBlob);
    }

    this.handleGetBuffer = function(data) {
      var buffer = data.buffer;
    }
  },

  initAudioVisualizationArea: function() {
    var self = this;
    var initCanvasWidth = self.$audioVisualizationArea.width();
    self.audioVisualizationAreaControl('init', initCanvasWidth);
  },

  audioVisualizationAreaControl: function(ctl, canvasWidth) {
    var self = this;
    var audioVisualizationArea = self.$audioVisualizationArea[0]; 

    // canvases init too when update/reset 
    self.initCanvases(canvasWidth);

    if(ctl == 'init') {
      Ps.initialize(audioVisualizationArea);

      self.initSelection();
      // resize the visualization area when the window is changed
      self.visualizationAreaResizeCtl();

      // load amr from server
      if(self.hasLoadedAudio) {
        self.trigger('stateChange', [{newState: 'loadedAudioProcessing'}]);
        self.visualizeLoadedAMR('init');
      }else {
        self.trigger('stateChange', [{newState: 'available', triggerEvent: 'inited'}]);
      }
    }else if(ctl == 'update') {
      Ps.update(audioVisualizationArea);
    }else if(ctl == 'reset') {
      Ps.destroy(audioVisualizationArea);
      Ps.initialize(audioVisualizationArea);   

      // reset 之前无法知道已录制视频的长短(即canvas的宽度)，
      // perfect-scrollbar destroy后，无法重置已有的scrollWidth
      // 需要出发一次滚动之后，重新计算新的scrollWidth;
      // 因此在canvases inited后，手动出发滚动条滚动，从而不会影响后续音轨绘制过程中相关width值的计算。
      // 
      // trigger the scroll width change by manually scroll the scrollbar
      self.$audioVisualizationArea.scrollLeft(100);  
      self.$audioVisualizationArea.scrollLeft(0);  

      self.initSelection();
      // resize the visualization area when the window is changed
      self.visualizationAreaResizeCtl();

      // reset sliderbar and selected area
      self.$sliderBar.css('left', self.canvasLeftOffset);
      self.$selectedArea.css({
          'left': 0,
          'width': 0
      });

      // load amr from server
      if(self.hasLoadedAudio) {
        self.trigger('stateChange', [{newState: 'loadedAudioProcessing'}]);
        self.visualizeLoadedAMR('reset');
      }else {
        self.trigger('stateChange', [{newState: 'available', triggerEvent: 'reseted'}]);
      }
    }
  },

  initCanvases: function(canvasWidth){
    var self = this;
    self.initTimeLine(canvasWidth);
    self.initAudioWave(canvasWidth);
  },

  initTimeLine: function (canvasWidth) {
    var self = this;
    var $timeLineCanvas = self.$timeLine;
    /*
      notice：the canvas will be clean, if the width is reset
    */
    $timeLineCanvas[0].width = canvasWidth;
    $timeLineCanvas.width(canvasWidth);

    var timeLineHeight = $timeLineCanvas.height();

    // should better to be a integer
    var widthPrePoint = self.widthPreSecond_px / self.pointsNumPreSecond;
    var computedPointsCount 
      = (canvasWidth - self.canvasLeftOffset - self.canvasRightOffset) / self.widthPreSecond_px * self.pointsNumPreSecond;
    var ceiledPointsCount = Math.ceil(computedPointsCount);

    // beginX(int) + 0.5 -> make the canvas line clear
    var beginX = Math.floor(self.canvasLeftOffset) + 0.5;

    var timeLineCtx   = $timeLineCanvas[0].getContext('2d');
    timeLineCtx.lineWidth   = self.defaultLineWidth;
    timeLineCtx.strokeStyle = self.defaultStrokeStyle;
    timeLineCtx.fillStyle   = self.defaultTextFillStyle;
    timeLineCtx.font        = self.defaultFont;
    
    timeLineCtx.beginPath();
    for(var i = 0; i <= ceiledPointsCount; i++) {
      timeLineCtx.moveTo(beginX, timeLineHeight);

      // draw formatted secends
      if(i % (self.pointsNumPreSecond * self.timeUnit_s) == 0) {
          timeLineCtx.lineTo(beginX, 0);
          timeLineCtx.fillText(self.formatTime(i/self.pointsNumPreSecond), beginX + 2, 12);
      }else {
          timeLineCtx.lineTo(beginX, 15);
      }

      beginX += widthPrePoint;
    }
    timeLineCtx.stroke();
  },

  initAudioWave: function(canvasWidth) {
    var self = this;
    var $audioWaveCanvas = self.$audioWave;

    $audioWaveCanvas[0].width = canvasWidth;
    $audioWaveCanvas.width(canvasWidth);

    // set initial value of beginX and waveWidth
    $audioWaveCanvas.data('beginX', self.canvasLeftOffset);
    $audioWaveCanvas.data('waveWidth', 0);

    var audioWaveHeight = $audioWaveCanvas.height();
    var halfHeight = audioWaveHeight / 2;

    var audioWaveCtx = $audioWaveCanvas[0].getContext('2d');
    audioWaveCtx.strokeStyle  = self.defaultStrokeStyle;
    audioWaveCtx.lineWidth    = self.defaultLineWidth;

    audioWaveCtx.beginPath();

    // draw the top border
    audioWaveCtx.moveTo(0, 0.5);
    audioWaveCtx.lineTo(canvasWidth, 0.5);

    // draw the bottom border
    audioWaveCtx.moveTo(0, audioWaveHeight - 0.5);
    audioWaveCtx.lineTo(canvasWidth, audioWaveHeight - 0.5);
    audioWaveCtx.stroke();

    // draw the highlight middle line
    audioWaveCtx.strokeStyle = self.defaultHLStrokeStyle; 
    audioWaveCtx.beginPath();
    // in case of halfHeight is not (int + 0.5)
    audioWaveCtx.moveTo(0, Math.floor(halfHeight) + 0.5);
    audioWaveCtx.lineTo(canvasWidth, Math.floor(halfHeight) + 0.5);

    audioWaveCtx.stroke();
  },

  initSelection: function() {
    var self = this,      
      $window = $(window),
      $audioVisualizationArea = self.$audioVisualizationArea,
      $audioWave = self.$audioWave,
      $sliderBar = self.$sliderBar,
      $selectedArea = self.$selectedArea,
      
      audioWaveWidth,
      selectedAreaAutoChangeInterval;

    // offsetX/offsetY 点击位置到元素左上角的距离
    // pageX/pageY 和 clientX/clientY 为点击位置到可视区域左上角的距离
    // screenX/screenY 为点击位置到屏幕窗口左上角的距离
    $audioWave.mousedown(function(e){
      // 现有音轨宽度
      audioWaveWidth = $audioWave.data('waveWidth');

      // computed the edge of visualization area      
      // $('.class').position() 获取匹配元素相对于父元素偏移
      // $('.class').offset() 获取匹配元素相对于当前视口的相对偏移 
      var visualizationAreaLeftEdgeX = $audioVisualizationArea.scrollLeft() + $audioWave.offset().left;
      var visualizationAreaRightEdgeX = visualizationAreaLeftEdgeX + $audioVisualizationArea.width();

      // 拖动开始位置
      var startX = e.offsetX;
      var endX;
      var endPageX;

      cancelSelectedArea();
      showSliderBar(startX);

      // 鼠标直接在音轨区域滑动
      $audioWave.mousemove(function(e){
        endX = e.offsetX;
        endPageX = e.pageX;
        // 选区终边移动到可视区域边缘时，自动滚动滚动条
        self.autoScrolled(endX, 10);
        showSelectedArea(startX, endX);
      });

      // 鼠标滑出音轨区域，在window范围内滑动的控制
      $audioWave.mouseout(function(e){
        $window.mousemove(function(e){
          selectedAreaAutoChangeInterval && clearInterval(selectedAreaAutoChangeInterval);

          var moveEndPageX = e.pageX;
          // 在可视化区域左侧
          if(moveEndPageX < visualizationAreaLeftEdgeX ) {
            // 鼠标持续滑动，避免重复定时
            selectedAreaAutoChangeInterval = setInterval(function(){
                selectedAreaAutoChange('left', 2);
            }, 1);
          // 在可视化区域右侧
          }else if(moveEndPageX > visualizationAreaRightEdgeX ) {
            // 鼠标持续滑动，避免重复定时
            selectedAreaAutoChangeInterval = setInterval(function(){
                selectedAreaAutoChange('right', 2);
            }, 1);
          // 在可视化区域内
          }else {
            var dValue = moveEndPageX - endPageX;
            endX = endX + dValue;
            endPageX = moveEndPageX;
            showSelectedArea(startX, endX);
          }
        })
        
        function selectedAreaAutoChange(direction, step) {
          if(direction === 'right') {
            endX += step;
          }else if(direction === 'left') {
            endX -= step;
          }
          if(endX > audioWaveWidth + self.canvasLeftOffset || endX < self.canvasLeftOffset) {
            // 需要清除选区自动变换计时器
            selectedAreaAutoChangeInterval && clearInterval(selectedAreaAutoChangeInterval); 
          }
          // 选区终边移动到可视区域边缘时，自动滚动滚动条
          self.autoScrolled(endX, 10);
          showSelectedArea(startX, endX);
        }
      });

      // 从音轨区域外进入音轨区域时，取消选区自动变换计时器，并解除window的mousemove事件
      $audioWave.mouseover(function(e){
        // 选区自动变换计时器存在时，取消计时器
        selectedAreaAutoChangeInterval && clearInterval(selectedAreaAutoChangeInterval); 
        $window.unbind('mousemove');
      });

      // 当鼠标弹起时，选区操作结束
      $window.mouseup(function(){
        mouseEnd(startX, endX);
      });
    });

    /*
      @ 通过拖动的起止位置来显示选区
      @params
        startX -> 拖动的起始位置
        endX -> 拖动的结束位置
     */
    function showSelectedArea(startX, endX) {
      if(endX == undefined) return;

      showSliderBar(startX, endX);

      startX = XLimit(startX);
      endX = XLimit(endX);

      if(startX > endX) {
        $selectedArea.css({
            'left': endX,
            'width': startX - endX
        });
      }else if (startX < endX) {
        $selectedArea.css({
            'left': startX,
            'width': endX - startX
        });
      }else {
        $selectedArea.css({
            'left': startX,
            'width': 0
        });
      }        
    }

    /*
        @ 鼠标事件结束时的函数处理（鼠标移出、鼠标弹起）
        @params
            startX -> 拖动的起始位置
            endX -> 拖动的结束位置
     */
    function mouseEnd(startX, endX) {
      $audioWave.unbind('mousemove').unbind('mouseout').unbind('mouseover');

      $window.unbind('mousemove').unbind('mouseup');

      // 清除选区自动变更计时器
      selectedAreaAutoChangeInterval && clearInterval(selectedAreaAutoChangeInterval);

      //如果没有选区，取消之前的选取
      if(startX === endX || endX === undefined){
        cancelSelectedArea();
        // 选区取消未做其他处理时，还原exceedLimit
        if(self.isExceedLimit_temp == true) {
          self.isExceedLimit_temp = false;
          self.isExceedLimit = true;
          self.showRecorderCtls();
        }
      }else {
        // 录音达到限制，并存在选区时，解除限制
        if(self.isExceedLimit == true){
          self.isExceedLimit_temp = true;
          self.isExceedLimit = false;
          self.showRecorderCtls();
        }
      }
    }

    /*
        @ 取消已有选取
     */
    function cancelSelectedArea() {
      $selectedArea.css({
          'left': 0,
          'width': 0
      });
    }

    /*
        @ 通过拖动的起止位置来显示滚动条
        @params
            startX -> 拖动的起始位置
            endX -> 拖动的结束位置
     */
    function showSliderBar(startX, endX) {
      $sliderBar.show();

      startX = XLimit(startX);
      endX = XLimit(endX);
      
      var offsetX;
      if(endX !== undefined) {
        if(startX < endX) {
            offsetX = startX;
        }else {
            offsetX = endX;
        } 
      }else {
        offsetX = startX;
      }  
      
      $sliderBar.css('left', offsetX);

      // 改变slider-bar的位置时，更新audio-wave的beginX
      $audioWave.data('beginX', offsetX);
    }

    /*
        @ x的值不能超过音轨(已画音轨)的边界区域
     */
    function XLimit(x) {
      if(x < self.canvasLeftOffset) {
          x = self.canvasLeftOffset;
      }
      if(x > audioWaveWidth + self.canvasLeftOffset) {
          x = audioWaveWidth + self.canvasLeftOffset;
      }
      return x;
    }
  },

  // scroll the ps automaticly when the selection or sliderbar move to the edge of the visualization area
  // endX -> 终边的X轴位置
  // offset -> 距离边界的多少距离时，开始scroll
  autoScrolled: function(endX, offset) {
      var self = this;

      var $audioVisualizationArea = self.$audioVisualizationArea;
      var scrollLeft = $audioVisualizationArea.scrollLeft();
      var visualizationAreaWidth = $audioVisualizationArea.width();

      // scroll to right
      if(endX + offset >= scrollLeft + visualizationAreaWidth) {
        $audioVisualizationArea.scrollLeft(endX + offset  - visualizationAreaWidth);
      }else if(endX - offset <= scrollLeft) {
      // scroll to left
        $audioVisualizationArea.scrollLeft(endX - offset);
      }
  },

  visualizationAreaResizeCtl: function() {
    var self = this;
    $(window).resize(function() {
      var $audioVisualizationArea = self.$audioVisualizationArea;
      var waveWidth = self.$audioWave.data('waveWidth');
      var visualizationAreaWidth = $audioVisualizationArea.width();

      // compute neededWidth
      var neededWidth = waveWidth + self.canvasLeftOffset + self.canvasRightOffset

      if( neededWidth > visualizationAreaWidth ) {
        self.audioVisualizationAreaControl('update', neededWidth);
      }else {
        self.audioVisualizationAreaControl('update', visualizationAreaWidth);
      }

      if(self.existedBuffer) {
        self.drawLoadedOrExistedAudioWave(self.existedBuffer);
      }
    });
  },

  // load amr and visualize
  visualizeLoadedAMR: function() {
    var self = this;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', self.loadedAudioURL, true);
    xhr.responseType = 'blob';
    xhr.onload = function() {
      self.readBlob(xhr.response, function(data) {
        console.time('amr文件解码时间');
        var buffer = AMR.toWAV(data);
        console.timeEnd('amr文件解码时间');

        var blob = new Blob([buffer], { type: 'audio/wav' });
        var fr = new FileReader();
        // var source = audioContext.createBufferSource();
        fr.onload = function(e) {
          audioContext.decodeAudioData(e.target.result, function(buffer) {
            console.time('加载音频可视化时间');
            self.drawLoadedOrExistedAudioWave(buffer);
            console.timeEnd('加载音频可视化时间');

            // put the load buffer into recorder
            recorder.loadAudio(buffer, self.unconvertEventsList);
            // save the existedBuffer and put the audio to audio element
            recorder.exportWAV(self.hanldeLoadedOrRecordedAudio.bind(self, true));

            // source.buffer = buffer;
            // source.connect(audioContext.destination);
            // source.start();  
          }, function(e) {
              console.warn(e);
          });
        }
        fr.readAsArrayBuffer(blob);
      });  
    };
    xhr.send();
  },

  // ***** TO DELETE/CHECK *****
  // load wav and visualize
  visualizeLoadedWAV: function() {
    var self = this;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'audio/tomorrow.wav', true);
    /* 字节流 arraybuffer */
    xhr.responseType = 'arraybuffer';

    xhr.onload = function() {
      // var source = audioContext.createBufferSource();
      audioContext.decodeAudioData(xhr.response, function(buffer) {
        console.time('加载音频可视化时间');
        self.drawLoadedOrExistedAudioWave(buffer, isReset);
        console.timeEnd('加载音频可视化时间');

        // put the load buffer into recorder
        recorder.loadAudio(buffer, self.unconvertEventsList);
        // save the existedBuffer and put the audio to audio element
        recorder.exportWAV(self.hanldeLoadedOrRecordedAudio.bind(self, true));   

        // source.buffer = buffer;
        // source.connect(audioContext.destination);
        // source.start();                        
      });
    };
    xhr.send();
  },

  // save the existedBuffer and put the audio to audio element
  hanldeLoadedOrRecordedAudio: function(isLoaded, blob) {
    console.log(blob,isLoaded)
    var self = this;
    // set existedBuffer the current recorded buffer
    var fr = new FileReader();
    fr.onload = function(e) {
      audioContext.decodeAudioData(e.target.result, function(buffer) {
        self.existedBuffer = buffer;        
        // convert duration to ms
        self.duration = Math.round(buffer.duration * 1000);

        if(self.duration > 0){
          self.hasRecordedAudio = true;          
        }
        // 录音暂停处理后/加载完成后也触发一次该事件
        if(isLoaded == true ) {
          self.trigger('stateChange', {newState: 'available', triggerEvent: 'loadedAudioProcessed'});
          self.trigger('stateChange', [{newState: 'available', triggerEvent: 'inited'}]);
        }else {
          self.trigger('stateChange', {newState: 'available', triggerEvent: 'recordingPaused'});          
        }
      }, function(e) {
        console.warn(e);
      });
    }
    fr.readAsArrayBuffer(blob);

    // put the audio to audio element
    var url = URL.createObjectURL(blob);
    var $recordedAudio = self.$recordedAudio;
    $recordedAudio.attr('src', url);
    $recordedAudio.attr('controls', true);
  },

  // ****** TO CHECK *****
  startRecording: function() {
    var self = this;

    self.trigger('stateChange', [{newState: 'recording', triggerEvent: 'recordingStarted'}]);

    self.isChanged = true;

    var $audioWave = self.$audioWave;
    var $selectedArea = self.$selectedArea;
    var $sliderBar = self.$sliderBar;

    var waveWidth = $audioWave.data('waveWidth');
    var selectedAreaWidth = $selectedArea.width();

    //  - self.canvasLeftOffset to compute the position in actural wave 
    if(selectedAreaWidth != 0) {
      // the position of slider-bar maybe changed when it is played in selected area
      // so the recordBeginX is left side of the selected area
      var recordBeginX = parseInt($selectedArea.css('left')) - self.canvasLeftOffset;
    }else {
      var recordBeginX = parseInt($sliderBar.css('left')) - self.canvasLeftOffset;
    } 

    var positionPercent = recordBeginX / waveWidth || 0;
    // positionPercent 存在计算误差超过1的情况，暂时使用这一hack
    positionPercent = Math.min(positionPercent, 1);
    var selectedPercent = selectedAreaWidth / waveWidth || 0;
    var restRightWidth = waveWidth - recordBeginX - selectedAreaWidth || 0;
    // 相应地 restRightWidth < 0
    restRightWidth =Math.max(restRightWidth, 0);

    // change the isInsertOrReplace to true when first insert or replace
    if( restRightWidth != 0 || selectedAreaWidth !=0 ) {
      self.isInsertOrReplace = true;
    }

    // process exist buffer 
    // to make the drawed buffer use the same color
    if(self.existedBuffer && self.isInsertOrReplace) {
      // re init audio wave canvas: reset the audioWave's data
      var visualizationAreaScrollWidth = self.$audioVisualizationArea[0].scrollWidth;
      self.audioVisualizationAreaControl('update', visualizationAreaScrollWidth);

      // redraw existBuffer
      self.drawLoadedOrExistedAudioWave(self.existedBuffer);

      // reset slider-bar' left and audio-wave' beginX
      $sliderBar.css('left', recordBeginX + self.canvasLeftOffset);
      $audioWave.data('beginX', recordBeginX + self.canvasLeftOffset);
    }

    if(selectedAreaWidth != 0 ) { 
      var canvasCtx    = $audioWave[0].getContext('2d');
      var canvasWidth  = $audioWave.width();
      var canvasHeight = $audioWave.height();
      var halfHeight   = canvasHeight / 2;

      // cancel selected area
      $selectedArea.css({
          'left': 0,
          'width': 0
      });

      // copy the right side image data
      if(restRightWidth != 0) {
          var selectedRightImgData = canvasCtx.getImageData(self.canvasLeftOffset + recordBeginX + selectedAreaWidth + 1, 0, waveWidth - recordBeginX - selectedAreaWidth, canvasHeight);
      }
      // clear the selected and right data
      canvasCtx.clearRect(recordBeginX + self.canvasLeftOffset + 1, 1, waveWidth  - recordBeginX, canvasHeight - 2);
      // middle line need to be redraw
      canvasCtx.strokeStyle = self.defaultHLStrokeStyle;
      canvasCtx.lineWidth = self.defaultLineWidth;
      canvasCtx.beginPath();
      canvasCtx.moveTo(recordBeginX + self.canvasLeftOffset + self.defaultLineWidth, halfHeight);
      canvasCtx.lineTo(waveWidth + self.canvasLeftOffset + 1, halfHeight);
      canvasCtx.stroke();

      if(restRightWidth != 0) {   
          canvasCtx.putImageData(selectedRightImgData, recordBeginX + self.canvasLeftOffset + 1, 0);
      }
      
      // update waveWidth
      $audioWave.data('waveWidth', waveWidth - selectedAreaWidth);
    }
    
    recorder && recorder.record(positionPercent, selectedPercent, restRightWidth);
  },

  pauseRecording: function() {
    var self = this;

    self.trigger('stateChange', [{newState: 'recordingPauseProcessing'}]);
    recorder && recorder.stop();
    self.restImgData = '';
    self.newRestRightWidth = 0;
    recorder.exportWAV(self.hanldeLoadedOrRecordedAudio.bind(self, false));
  },

  playAudio: function() {
    var self = this;

    var $recordedAudio = self.$recordedAudio;

    var $audioWave = self.$audioWave;
    var $selectedArea = self.$selectedArea;
    var $sliderBar = self.$sliderBar;

    var waveWidth = $audioWave.data('waveWidth');
    var selectedAreaWidth = $selectedArea.width();
    var duration = $recordedAudio[0].duration;

    /* position about play need to minus the canvasLeftOffset/canvasRightOffset */
    var playBeginX = parseInt($sliderBar.css('left')) - self.canvasLeftOffset;

    var playFrom, playTo;

    var endedTime;

    // has selected area
    if(selectedAreaWidth != 0) {
        playFrom = parseInt($selectedArea.css('left')) - self.canvasLeftOffset;
        playTo = playFrom + selectedAreaWidth;
        endedTime = playTo / waveWidth * duration;

        $recordedAudio.bind('timeupdate', self.playTimeupdateListener(endedTime));
    }else {
    // has no selected area
        playFrom = 0;
        playTo = waveWidth;

        $recordedAudio.bind('ended', self.playEndedListener.bind(self));
    }

    // playBeginX == playTo, start at playFrom
    if(playBeginX == playTo){
        playBeginX = playFrom;
        // set the position of slider-bar
        $sliderBar.css('left', playFrom + self.canvasLeftOffset);
    }

    var currentTime = playBeginX / waveWidth * duration || 0;
    self.playBegin_ms = Math.ceil(currentTime * 1000);

    self.trigger('stateChange', [{newState: 'playing', triggerEvent: 'playingStarted'}]);

    $recordedAudio[0].currentTime = currentTime;
    $recordedAudio[0].play();

    /* 方案一 */
    // timeupdate 当媒介改变其播放位置时触发的事件，但是过程不平缓，不能用此方式实现slider-bar的随动
    // $recordedAudio[0].addEventListener('timeupdate', function() {
    //     var currentTime = $(self)[0].currentTime;
    //     var left = currentTime / duration * waveWidth + self.canvasLeftOffset;
    //     console.log(currentTime)
    //     $('.slider-bar').css('left', left);
    // }, false);

    /* 方案二 */
    self.moveSliderBarAsPlayInterval = setInterval(function() {
        self.moveSliderBarAsPlay(playTo, 1);
    }, 1000 / self.widthPreSecond_px); // compute interval by the offset in moveSliderBarAsPlay
  },

  // offset -> sliber-bar move by offset 
  moveSliderBarAsPlay: function(playTo, offset /* 移动的幅度 */) {
    var self = this;
    var $sliderBar = self.$sliderBar;
    var left = parseInt($sliderBar.css('left'));
    left += offset;

    // move slider-bar in the range of playTo
    if( left <= playTo + self.canvasLeftOffset){
      $sliderBar.css('left', left);
      self.autoScrolled(left, 5);
    }    
  },

  // has selected area
  playTimeupdateListener: function(endedTime) {
    var self = this;
    return function listenerHandle(){
      var currentTime = self.$recordedAudio[0].currentTime;
      if(currentTime >= endedTime){
        $(this)[0].pause();
        self.resetAfterPlayEnded();
        self.$recordedAudio.unbind('timeupdate');
      }
    }
  },

  // no selected area
  playEndedListener: function() {
    var self = this;
    self.resetAfterPlayEnded();
    self.$recordedAudio.unbind('ended');
  },

  // auto play ended reset
  resetAfterPlayEnded: function() {
    var self = this;
    var $recordedAudio = self.$recordedAudio;

    clearInterval(self.moveSliderBarAsPlayInterval);
    self.trigger('stateChange', [{newState: 'available', triggerEvent: 'playingEnded'}])   
  },

  pauseAudio: function() {
    var self = this;

    self.trigger('stateChange', [{newState: 'available', triggerEvent: 'playingPaused'}]);

    self.$recordedAudio[0].pause();  

    clearInterval(self.moveSliderBarAsPlayInterval);
  },

  completeRecording: function() {
    var self = this;

    self.trigger('stateChange', [{newState: 'recordingCompleteProcessing'}]);

    // if the recording has change do the wav2amr
    if(self.isChanged) {
      // wav to amr file
      self.wav2amr();
    }else {
      self.trigger('stateChange', [{newState: 'available', triggerEvent: 'recordingCompleted'}]);
    }

    recorder.clear();
  },

  // wav to amr file after recording completed
  wav2amr: function() {
    recorder && recorder.exportWAV(this.wavBlob2Amr.bind(this));
  }, 
  
  // convert the exported wav blob to amr
  wavBlob2Amr: function(blob) {
    var self = this;

    self.handleWAV(blob);

    self.readBlob(blob, function(data) {
        audioContext.decodeAudioData(data.buffer, function(audioBuffer) {
            var pcm;
            if (audioBuffer.copyFromChannel) {
                pcm = new Float32Array(audioBuffer.length);
                audioBuffer.copyFromChannel(pcm, 0, 0);
            } else {
                pcm = audioBuffer.getChannelData(0);
            }

            var amr = AMR.encode(pcm, audioBuffer.sampleRate, 7);

            self.handleAMR(new Blob([amr], {type: 'datatype/sound'}));
        });
    });
  },

  handleWAV: function(blob) {
    var self = this;
    // show WAV download anchor
    var url = URL.createObjectURL(blob);
    self.$wavDownloadAnchor = $('<a/>').addClass('wav-download-anchor').appendTo(self.$recordedArea);;
    self.$wavDownloadAnchor
      .attr('href', url)
      .html('Download(wav file)')
      .attr('download', new Date().toISOString() + '.wav');
  },

  handleAMR: function(blob) {
    var self = this;

    // show AMR download anchor
    var url = URL.createObjectURL(blob);
    self.$amrDownloadAnchor = $('<a/>').addClass('amr-download-anchor').appendTo(self.$recordedArea);
    self.$amrDownloadAnchor
      .attr('href', url)
      .html('Download(amr file)')
      .attr('download', new Date().toISOString() + '.amr');

    // upload amr file
    self.uploadAmrFile(blob);

    self.trigger('stateChange', [{newState: 'available', triggerEvent: 'recordingCompleted'}]);
  },

  uploadAmrFile: function(blob) {
    console.warn('You\'d better give a function named "uploadAmrFile" to RecordingEditor which can upload "blob" to the server!');
  },
 
  // ************ TO CHECK *********
  drawLoadedOrExistedAudioWave: function(audioBuffer) {
    var self = this;
    var isReset = isReset || undefined;
    var $timeLineCanvas = self.$timeLine;
    var $audioWaveCanvas = self.$audioWave;
    var $sliderBar = self.$sliderBar;

    var beginX     = $audioWaveCanvas.data('beginX');
    var waveWidth    = $audioWaveCanvas.data('waveWidth');
    var canvasWidth  = $audioWaveCanvas.width();
    var canvasHeight = $audioWaveCanvas.height();
    var halfHeight   = canvasHeight / 2;

    var audioChannelData = audioBuffer.getChannelData(0);  
    var sampleRate = audioBuffer.sampleRate;
    var bufferLen = audioChannelData.length;    

    var sliceWidth = self.widthPreSecond_px * self.omittedSamplesNum / sampleRate  ;
    
    var audioVisualizationAreaWidth = self.$audioVisualizationArea[0].scrollWidth;
    
    /* 
      compute the total width of the canvas
      if the computed width > audio visualization area width, update area
     */
    var computedCanvasWidth = bufferLen / self.omittedSamplesNum * sliceWidth + beginX + self.canvasRightOffset;
    if((computedCanvasWidth > audioVisualizationAreaWidth)) {
      self.audioVisualizationAreaControl('update', Math.ceil(computedCanvasWidth));
    }
    
    var canvasCtx = $audioWaveCanvas[0].getContext('2d');

    var y = 0,
      beginXOffset;

    canvasCtx.beginPath();
    canvasCtx.lineWidth = self.defaultLineWidth;
    canvasCtx.strokeStyle = self.defaultWaveStrokeStyle;

    for(var i = 0; i < bufferLen; i += self.omittedSamplesNum){
      // make sure to be (int + 0.5)
      beginXOffset = Math.floor(beginX) + 0.5;

      y = audioChannelData[i] < 0 
          ? ( halfHeight * ( self.defaultLineWidth + Math.abs(audioChannelData[i]) ) ) 
          : halfHeight * (1 - audioChannelData[i]);

      canvasCtx.moveTo(beginXOffset, y);
      canvasCtx.lineTo(beginXOffset, canvasHeight - y);

      $sliderBar.css('left', Math.ceil(beginX));

      beginX += sliceWidth;

      $audioWaveCanvas.data('beginX', beginX);  
    }
    canvasCtx.stroke();

    waveWidth = Math.ceil(beginX - sliceWidth - self.canvasLeftOffset);
    $audioWaveCanvas.data('waveWidth', waveWidth);
  },

  // restRightWidth -> the width form right side which does not redraw when the selection area existed
  // (即当时选区插入操作时，右侧部分不需要重绘)
  drawAudioWave: function(audioBuffer, positionPercent, selectedPercent, restRightWidth) {  
    var self = this;

    var $timeLineCanvas  = self.$timeLine;
    var $audioWaveCanvas = self.$audioWave;
    var $sliderBar       = self.$sliderBar;

    var beginX       = $audioWaveCanvas.data('beginX');
    var waveWidth    = $audioWaveCanvas.data('waveWidth');
    var canvasWidth  = $audioWaveCanvas.width();
    var canvasHeight = $audioWaveCanvas.height();
    var halfHeight   = canvasHeight / 2;

    var audioChannelData = audioBuffer.getChannelData(0);  
    var sampleRate       = audioBuffer.sampleRate;
    var bufferLen        = audioChannelData.length;    

    // compute the distance of two wave line(vertical line) 
    var sliceWidth = self.widthPreSecond_px * self.omittedSamplesNum / sampleRate;

    var canvasCtx = $audioWaveCanvas[0].getContext('2d');

    var y = 0,
      beginXOffset;
    for(var i = 0; i < bufferLen; i += self.omittedSamplesNum){ 
      // make it to be (int + 0.5)
      beginXOffset = Math.floor(beginX) + 0.5;

      // 计算当前canvas需要的宽度，判断是否需要进行resizeCanvas
      var currentCanvasWidth;

      // 当存在选区，且右侧剩余宽度不为0时，进行插入操作，并且每次将右侧canvas内容复制在最后(在本次绘制完成后put)
      // get imgdata of the right side rest 
      if(selectedPercent != 0 && restRightWidth != 0) {
        // 本次录音过程中，将restImgData暂存，暂停录音时，reset该值
        self.restImgData = self.restImgData || canvasCtx.getImageData(waveWidth - restRightWidth + self.canvasLeftOffset , 0, restRightWidth, canvasHeight);;

        // clean right canvas
        canvasCtx.clearRect(waveWidth - restRightWidth + self.canvasLeftOffset, 1, restRightWidth, canvasHeight - 2);

        canvasCtx.strokeStyle = self.defaultHLStrokeStyle;
        canvasCtx.lineWidth = self.defaultLineWidth;
        canvasCtx.beginPath();
        // draw the middle line again
        canvasCtx.moveTo(waveWidth - restRightWidth + self.canvasLeftOffset, halfHeight);
        canvasCtx.lineTo(waveWidth - restRightWidth + self.canvasLeftOffset + restRightWidth, halfHeight);
        canvasCtx.stroke();
        
        currentCanvasWidth = beginXOffset + restRightWidth + self.canvasRightOffset;

      // 当不存在选区，且右侧剩余宽度不为0时，进行替换操作，逐步替换右侧内容
      }if(selectedPercent == 0 && restRightWidth != 0) {
        self.newRestRightWidth = self.newRestRightWidth ? self.newRestRightWidth - sliceWidth : restRightWidth - sliceWidth;

        // clear的最小单位为1px, Math.ceil(sliceWidth)进行取整
        // clean canvas by next sliceWidth
        canvasCtx.clearRect(beginX, 1, Math.ceil(sliceWidth), canvasHeight - 2);

        canvasCtx.strokeStyle = self.defaultHLStrokeStyle;
        canvasCtx.lineWidth = self.defaultLineWidth;
        canvasCtx.beginPath();
        // draw the middle line again
        canvasCtx.moveTo(beginX, halfHeight);
        canvasCtx.lineTo(beginX + Math.ceil(sliceWidth), halfHeight);
        canvasCtx.stroke();

        currentCanvasWidth = beginXOffset + self.canvasRightOffset;
        

      // 其他情况相当于在后侧插入新的内容
      }else {
        currentCanvasWidth = beginXOffset + self.canvasRightOffset;
      } 

      if(currentCanvasWidth >= canvasWidth ) {
        // if the width is less than the needed, add self.widthPreSecond_px * self.timeUnit_s，避免频繁进行resizeCanvas
        var newCanvasWidth = Math.ceil(currentCanvasWidth + self.widthPreSecond_px * self.timeUnit_s);
          // update canvasWidth, or next for still will be in self if 
          canvasWidth = newCanvasWidth;
          self.resizeCanvas(newCanvasWidth);
      }

      // the canvas width maybe change in self loop, so complete the path in the loop
      canvasCtx.beginPath();
      canvasCtx.lineWidth = self.defaultLineWidth;

      // if the wave is inserted or replaced, change the stroke style 
      canvasCtx.strokeStyle = self.isInsertOrReplace ? self.modifiedWaveStrokeStyle : self.defaultWaveStrokeStyle;

      // computed y / use vertial line
      y = audioChannelData[i] < 0 
          ? ( halfHeight * ( 1 + Math.abs(audioChannelData[i]) ) ) 
          : halfHeight * (1 - audioChannelData[i]);

      canvasCtx.moveTo(beginXOffset, y);
      canvasCtx.lineTo(beginXOffset, canvasHeight - y);
      canvasCtx.stroke();

      if(selectedPercent !=0 && restRightWidth != 0) {
        canvasCtx.putImageData(self.restImgData, Math.ceil(beginX), 0);
      }

      $sliderBar.css('left', Math.ceil(beginX));
      // scroll perfectScrollbar as the slider-bar move
      scrollPerfectScrollbar();

      if(selectedPercent != 0 && restRightWidth != 0) {
        waveWidth = Math.ceil(beginX + restRightWidth - self.canvasLeftOffset);
      }else if(selectedPercent == 0 && restRightWidth != 0) {
        // 当逐步替换超出之前音轨的距离时，开始计算新的音轨宽度
        if(self.newRestRightWidth < 0) {
          waveWidth = Math.ceil(beginX - self.canvasLeftOffset);
        }
      }else{
        waveWidth = Math.ceil(beginX - self.canvasLeftOffset);
      }
      $audioWaveCanvas.data('waveWidth', waveWidth);

      beginX += sliceWidth;
      
      $audioWaveCanvas.data('beginX', beginX);  
    }


    function scrollPerfectScrollbar() {
      var $audioVisualizationArea = self.$audioVisualizationArea;
      var currentScrollLeft = $audioVisualizationArea.scrollLeft();

      var $canvases = $audioVisualizationArea.find('.canvases');  
      var $sliderBar = self.$sliderBar;    
      var canvasesWidth = $canvases.width();
      var sliderBarLeft = parseInt($sliderBar.css('left'));
      var computedScrollLeft = sliderBarLeft - canvasesWidth + self.canvasRightOffset;
      if(currentScrollLeft < computedScrollLeft){
        $audioVisualizationArea.scrollLeft(computedScrollLeft);
      }
    }
  },

  resizeCanvas: function(width) {
    var self = this;
    var $audioWave = self.$audioWave;

    // copy image data
    var audioWaveCtx = $audioWave[0].getContext('2d');
    var currentImgData = audioWaveCtx.getImageData(0, 0, $audioWave[0].width, $audioWave[0].height);
    
    // update width
    self.audioVisualizationAreaControl('update', width);
    
    // put image data
    audioWaveCtx.putImageData(currentImgData, 0, 0);  
  }, 

  addEvents: function(eventType) {
    var self = this;
    self.currentEvent = eventType;
  },

  prev: function() {
    this.addEvents('prev');
  },

  next: function() {
    this.addEvents('next');
  },

  reset: function(config) {
    var self = this;

    self.trigger('stateChange', [{newState: 'reseting'}]);
    
    self.resetDefaultProps();
    // extend must after reset default props 
    $.extend(true, self, config); 

    self.resetRecorder();  
    self.resetRecordedArea();
    self.resetAudioVisualizationArea();

    // self.trigger('stateChange', [{newState: 'available', triggerEvent: 'reseted'}]);
  },

  resetDefaultProps: function() {
    var self = this;

    self.hasLoadedAudio = false; 
    self.loadedAudioURL = '';

    self.isExceedLimit_temp = false;
    self.isExceedLimit = false;

    // properties in the process of recording
    self.hasRecordedAudio    = false;
    self.isChanged           = false,
    self.isInsertOrReplace   = false;
    self.existedBuffer       = '';
    self.restImgData         = '';
    self.newRestRightWidth   = 0;
    self.currentEvent        = undefined;
    self.unconvertEventsList = undefined,
    self.eventsList          = {};
    self.samplesCount        = 0;
    self.duration            = 0;

    // properties in the process of playing
    self.playBegin_ms        = 0;
  },

  resetRecorder: function() {
    // reset the recorder
    recorder.clear();
  },

  resetRecordedArea: function() {
    var self = this;
    // reset the recorded audio
    self.$recordedAudio.attr('src', '');
    // remove download anchor
    self.$recordedArea.find('a').remove();
  }, 

  resetAudioVisualizationArea: function() {
    var self = this;
    var resetCanvasWidth = self.$audioVisualizationArea.width();
    self.audioVisualizationAreaControl('reset', resetCanvasWidth);
  },  

  hide: function() {
    var self = this;
    self.$RecordingEditor.addClass('hide');
  },

  show: function() {
    var self = this;
    self.$RecordingEditor.removeClass('hide');
  }
};

/*** extend utility functions to Recordding.prototype ***/
$.extend(true, RecordingEditor.prototype, {

  // faked 'on' function: this.on -> this.$RecordingEditor.on
  on: function(eventType, callback) {
    this.$RecordingEditor.on( 
      eventType,
      /* data, // data -> event.data in callback*/ 
      function(event, data /* fisrt value in 'params' array from 'trigger' */) { 
        callback(event, data); 
      }
    );
    return this;
  },

  // faked 'off' function: this.off -> this.$RecordingEditor.off
  off: function(eventType) {
    this.$RecordingEditor.off(eventType);
    return this;
  },

  // faked 'trigger' function: this.trigger -> this.$RecordingEditor.trigger
  trigger: function(eventType, params) {
    this.$RecordingEditor.trigger( 
      eventType, 
      params /* [{a: 1, b: 2}] -> {a: 1, b: 2} pass to the callback in 'on' as data */ 
    );
    return this;
  },

  formatTime: function(s){
    // s show be less than 3600
    if(s >= 3600) {
      console.warm('the given "s" should be <= 3600!');
      return '00:00';
    }

    var minites = Math.floor(s / 60);
    var formattedMinites = minites < 10 ? '0' + minites : minites.toString(10);

    var seconds = s - minites * 60;
    var formattedSeconds = seconds < 10 ? '0' + seconds : seconds.toString(10);

    var formattedTime = formattedMinites + ':' + formattedSeconds;

    return formattedTime;
  },

  readBlob: function(blob, callback) {
    var reader = new FileReader();
    reader.onload = function(e) {
        var data = new Uint8Array(e.target.result);
        callback(data);
    };
    reader.readAsArrayBuffer(blob);
  }
}); 


RecordingEditor.prototype.init.prototype = RecordingEditor.prototype;

window.RE = window.RecordingEditor = RecordingEditor;

})(window);
