(function(window, undefined) {
var document = window.document,

	version = '0.0.1',

	audioContext,

	recorder,

	RecordingEditor = function(config) {
		return new RecordingEditor.prototype.init(config);
	};

RecordingEditor.prototype = {
	version: version,

  // set prototype {} need to give the constructor
	constructor: RecordingEditor,

  $insertElement: $('body'),  // insert the rootDOM to body by default

	// default properties about canvas's layout and drawing
	canvasLeftOffset:      20,  // begin position of time line and audio wave  
	canvasRightOffset:     30,
	widthPreSecond_px:     60,
	pointsNumPreSecond:    10,
	omittedSamplesNum:     256, // must be 2^n and <= 4096
  defaultLineWidth:      1,
  defaultFont:             '10px April',
	defaultStrokeStyle:      '#444',
	defaultHLStrokeStyle:    '#666',
	defaultTextFillStyle:    '#fff',
	defaultWaveStrokeStyle:  '#090',
	modifiedWaveStrokeStyle: '#d00', // color of inserted or replaced wave

	// properties about loaded audio
  hasLoadedAudio:    false, 
  loadedAudioURL:    'audio/ddd.amr', 

  // properties in the process of recording
	hasRecordedAudio:  false,
	isInsertOrReplace: false,
	existedBuffer:     '',
  restImgData:       '',
	currentEvent:      undefined,
	eventsList:        {},
	samplesCount:      0,  // sample counts of the recorded audio
  duration:          0,

  // worker path for recorder's web worker
  WORKER_PATH: 'js/lib/recorder/RecorderWorker.js',
  // WORKER_PATH: 'static/js/lib/RecorderWorker.js',

  init: function( config ) {
    var self = this;
    // extend(merge) the config to default properties
    $.extend(true, self, config);   

    self.initDOM();
    self.initRecorder();
    self.initRecorderCtls();
    self.initAudioVisualizationArea();

    return self;
  },

  initDOM: function() {
    var self = this;

    // insert rootDOM($RecordingEditor) to $insertElement
    self.rootDOM = self.$RecordingEditor = $('<div/>')
      .addClass('recording-editor')
      .appendTo(self.$insertElement);

    // recorder ctls
    self.$recorderCtls = $('<div/>')
      .addClass('recorder-ctls')
      .appendTo(self.$RecordingEditor);

    // record ctl
    self.$recordCtl = $('<div/>')
      .addClass('recorder-ctl record record-start')
      .appendTo(self.$recorderCtls)
      .append($('<i/>').addClass('icon iconfont icon-record'));

    // play ctl
    self.$playCtl = $('<div/>')
      .addClass('recorder-ctl audio audio-play')
      .appendTo(self.$recorderCtls)
      .append($('<i/>').addClass('icon iconfont icon-play'));

    // complete ctl
    self.$completeCtl = $('<div/>')
      .addClass('recorder-ctl record-complete')
      .appendTo(self.$recorderCtls)
      .append($('<i/>').addClass('icon iconfont icon-complete'));

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
                        .data('beginX', 0)
                        .appendTo($canvases);
    
    self.$selectedArea = $('<div/>').addClass('selected-area').appendTo($canvases);

    self.$sliderBar = $('<div/>').addClass('slider-bar').appendTo($canvases);

    // recorded area, include recorded audio, download links of wav file and amr file
    self.$recordedArea = $('<div/>')
      .addClass('recorded-area' + (self.showRecordedArea ? '' : ' hide'))
      .appendTo(self.$RecordingEditor);

    self.$recordedAudio = $('<audio/>')
      .addClass('recorded-audio')
      .attr('controls',true)
      .appendTo(self.$recordedArea);
  },

  initRecorder: function() { 
    var self = this;
    // audiocontext init, userMedia init
    try {
        // shim
        window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;

        // getUserMedia
        navigator.getUserMedia = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);

        window.URL = window.URL || window.webkitURL || window.mozURL;

        // 创建好音频上下文
        audioContext = new AudioContext();

        console.log('AudioContext set up!');
        console.log('navigator.getUserMedia ' + (navigator.getUserMedia ? 'supported' : 'not supported') + '!');

    }catch (e) {
        console.warn('Web audio API is not supported in this browser');
    }

    navigator.getUserMedia({
        audio: true
    }, self.initUserMedia.bind(self), function(e){
        console.warn('No live audio input:' + e);
    });
  },

  /*
      @ getUserMedia callback
  */
  initUserMedia: function(stream) {
    var self = this;

    var inputStream = audioContext.createMediaStreamSource(stream);
    recorder = new self.Recorder(inputStream, {}, self);

    console.log('recorder inited!');
  },

  // ********** TO CHECK **********
  // recorder 的内部实现机制
	// self point to this/RecorderEditor
	Recorder: function(source, cfg, RecorderEditor){
    var self = RecorderEditor;

    var config = cfg || {};
    var bufferLen = config.bufferLen || 4096;
    this.context = source.context;
    this.node = this.context.createScriptProcessor(bufferLen, 2, 2);
    var worker = new Worker(config.workerPath || self.WORKER_PATH);

    worker.postMessage({
      command: 'init',
      config: {
        sampleRate: this.context.sampleRate
      }
    });

    //从服务器加载的音频文件, 将其放入音频流中
    this.loadAudio = function(inputBuffer) {
      worker.postMessage({
        command: 'loadAudio',
        buffer: [
          inputBuffer.getChannelData(0),
          inputBuffer.getChannelData(0)
        ]
      });
    }

    // 不能将recording设为Recorder的属性，因为onaudioprocess中需要调用
    var recording = false,
      currCallback,
      restRightWidth = 0,
      positionPercent = 0,
      selectedPercent = 0;

    var prev = new Date().getTime();
    this.node.onaudioprocess = function(e){
      if (!recording) return;

      var now = new Date().getTime();
      console.log('audio processing time', now - prev);
      prev = now;

      // restRightWidth = $('.audio-wave').data('waveWidth') - $('.audio-wave').data('beginX') + canvasLeftOffset;
      // restRightWidth = restRightWidth < 0 ? 0 : restRightWidth;
      
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

      self.currentEvent = undefined;
    }

    /*
      @ Recorder 配置函数
      @ params 
          cfg(数组类型) -> Recorder的配置参数数组
     */
    this.configure = function(cfg){
      for (var prop in cfg){
        if (cfg.hasOwnProperty(prop)){
          config[prop] = cfg[prop];
        }
      }
    }

    this.record = function(positionPercentTemp, selectedPercentTemp, restRightWidthTemp){
      recording = true;

      positionPercent = positionPercentTemp || 0;
      selectedPercent = selectedPercentTemp || 0;
      restRightWidth  = restRightWidthTemp  || 0;

      console.log(positionPercent, selectedPercent, restRightWidth);

      // 点击开始录音时，设定本次录音插入的位置
      worker.postMessage({
        command: 'insert',
        positionPercent: positionPercent,
        selectedPercent: selectedPercent
      });
    }

    this.stop = function(){
      recording = false;
    }

    this.reset = function(){
      worker.postMessage({ command: 'reset' });
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

    worker.onmessage = function(e){
      if(e.data.exceedLimit){
        $('.recorder-ctl.record')
            .click().unbind('click')
            .addClass('disabled')
            .attr('tooltips','超过最大录音限制');
        $('.audio-visualization-area').addClass('exceed-limit');
        return;
      }

      var blob = e.data.audioBlob;
      var events = e.data.eventsList;
      var len = e.data.len;

      self.eventsList = events;
      self.samplesCount = len;

      console.log('事件列表', events, events.length, len);
      console.log(blob)

      currCallback(blob);
    }

    source.connect(this.node);
    this.node.connect(this.context.destination);    //this should not be necessary
  },

  initRecorderCtls: function () {
    var self = this;

    // init ctls
    self.initRecordCtl();
    self.initPlayCtl();
    self.initCompleteCtl();

    // init ctls' tooltips
    self.initTooltips();
  },

  initRecordCtl: function() {
    var self = this;
    
    self.$recordCtl.attr('tooltips','开始录音').removeClass('disbaled').click(function() {
      if($(this).hasClass('record-start')) {
        // change style and content
        $(this).removeClass('record-start').addClass('record-pause').attr('tooltips','暂停录音')
          .find('i').removeClass('icon-record').addClass('icon-pause');

        // limit
        self.$playCtl.addClass('disabled').attr('tooltips', '录制中，无法播放');
        self.deinitPlayCtl();
        self.$completeCtl.addClass('disabled').attr('tooltips', '录制中，无法完成录音');
        self.deinitCompleteCtl();

        // no operation in visualization-area
        self.$audioVisualizationArea.addClass('disabled');

        self.startRecording();
      }else if($(this).hasClass('record-pause')) {
        // change style and content
        $(this).removeClass('record-pause').addClass('record-start').attr('tooltips','开始录音')             
          .find('i').removeClass('icon-pause').addClass('icon-record');

        // remove limit
        // 暂停处理完成后
        self.off('recordingPaused').on('recordingPaused', function(e){
          self.hasRecordedAudio = true;
          self.$playCtl.removeClass('disabled').attr('tooltips','开始播放');
          self.initPlayCtl();
          self.$completeCtl.removeClass('disabled').attr('tooltips','完成录音');
          self.initCompleteCtl();
          // off listener
          self.off('recordingPaused');
        });

        // remove no operation in visualation-area
        self.$audioVisualizationArea.removeClass('disabled');

        console.time('stop record 所需时间为');
        self.pauseRecording();
      }
    });
  },

  initPlayCtl: function() {
    var self = this;

    if( !(self.hasLoadedAudio || self.hasRecordedAudio) ) {
      self.$playCtl.addClass('disabled').attr('tooltips','暂无音频，无法播放');
      return;
    }else {
      self.$playCtl.removeClass('disabled');
    }

    self.$playCtl.attr('tooltips','开始播放').click(function() {
      if($(this).hasClass('audio-play')) {
        $(this).removeClass('audio-play').addClass('audio-pause').attr('tooltips','暂停播放')
          .find('i').removeClass('icon-play').addClass('icon-pause');

        // limit
        self.$recordCtl.addClass('disabled').attr('tooltips', '播放中，无法录制');
        self.deinitRecordCtl();
        self.$completeCtl.addClass('disabled').attr('tooltips', '录制中，无法完成录音');
        self.deinitCompleteCtl();

        self.$audioVisualizationArea.addClass('disabled');

        self.playAudio();
      }else if($(this).hasClass('audio-pause')) {
        $(this).removeClass('audio-pause').addClass('audio-play').attr('tooltips','开始播放')
          .find('i').removeClass('icon-pause').addClass('icon-play');

        self.$recordCtl.removeClass('disabled').attr('tooltips','开始录音');
        self.initRecordCtl();
        self.$completeCtl.removeClass('disabled').attr('tooltips','完成录音');
        self.initCompleteCtl();

        self.$audioVisualizationArea.removeClass('disabled');

        self.pauseAudio();
      }
    });
  },

  initCompleteCtl: function() {
    var self = this;

    if( !(self.hasLoadedAudio || self.hasRecordedAudio) ) {
      self.$completeCtl.addClass('disabled').attr('tooltips','暂无音频，无法保存');
      return;
    }else {
      self.$completeCtl.removeClass('disabled');
    }

    self.$completeCtl.attr('tooltips','完成录音').click(function() {
      // self.hide();
      self.completeRecording();
    });
  },

  deinitRecordCtl: function() {
    var self = this;
    self.$recordCtl.unbind('click');
  },  

  deinitPlayCtl: function() {
    var self = this;
    self.$playCtl.unbind('click');
  },

  deinitCompleteCtl: function() {
    var self = this;
    self.$completeCtl.unbind('click');
  },

  initTooltips: function() {
    var self = this;
    self.$RecordingEditor.find('div[tooltips]').mouseover(function(){
      var tooltips = $(this).attr('tooltips');
      var tipsLen = tooltips.length + 1;
      $('<div>').html(tooltips).css('width', tipsLen + 'em').addClass('tooltips').appendTo($(this));
    });
    self.$RecordingEditor.find('div[tooltips]').mouseout(function(){
      $('.tooltips', $(this)).remove();
    });
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
        self.visualizeLoadedAMR();
      }
    }else if(ctl == 'update') {
      Ps.update(audioVisualizationArea);
    }else if(ctl == 'reset') {
      Ps.destroy(audioVisualizationArea);
      Ps.initialize(audioVisualizationArea);   

      // 
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
        self.visualizeLoadedAMR();
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
      if(i % self.pointsNumPreSecond == 0) {
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

  // ********** TO CHECK **********
  initSelection: function() {
    var self = this;
    var $window = $(window);
    var $audioWave = self.$audioWave;
    var $sliderBar = self.$sliderBar;
    var $selectedArea = self.$selectedArea;

    var audioWaveWidth;

    var selectedAreaAutoChangeInterval;

    // offsetX/offsetY 点击位置到元素左上角的距离
    // pageX/pageY 和 clientX/clientY 为点击位置到可视区域左上角的距离
    // screenX/screenY 为点击位置到屏幕窗口左上角的距离
    $audioWave.mousedown(function(e){
      // 现有音轨宽度
      audioWaveWidth = $audioWave.data('waveWidth');

      // 鼠标事件开始时，隐藏进度滚动条
      $sliderBar.hide();

      // 拖动开始位置
      var startX = e.offsetX;
      var endX;

      var moveStartX = startX;
      var moveEndX;

      // 鼠标直接在音轨区域滑动
      $audioWave.mousemove(function(e){
        endX = e.offsetX;
        moveEndX = endX;
        // 选区终边移动到可视区域边缘时，自动滚动滚动条
        self.autoScrolled(endX, 5);
        // 判断区域内move的方向
        if(moveEndX > moveStartX){ 
            showSelectedArea(startX, endX, 'right');
        }else if(moveStartX > moveEndX){
            showSelectedArea(startX, endX, 'left');
        }
        // 方向判断完毕，更新start的值
        moveStartX = moveEndX;
      });

      // 鼠标滑出音轨区域，在window范围内滑动的控制
      $audioWave.mouseout(function(e){
        // moveStartX1用于判断鼠标滑动的左右方向，需要实时变更，不能只保持为mouseout时的值
        var moveStartX1 = e.pageX;
        var moveEndX1;

        // 在window区域滑动时，选区自动变换
        $window.mousemove(function(e){
          moveEndX1 = e.pageX;
          clearInterval(selectedAreaAutoChangeInterval);
          // 判断滑动的方向
          if(moveEndX1 > moveStartX1){   
              // 鼠标持续滑动，避免重复定时
              selectedAreaAutoChangeInterval = setInterval(function(){
                  selectedAreaAutoChange('right', 2);
              }, 1);
          }else if(moveStartX1 > moveEndX1){
              // 鼠标持续滑动，避免重复定时
              selectedAreaAutoChangeInterval = setInterval(function(){
                  selectedAreaAutoChange('left', 2);
              }, 1);
          }
          // 方向判断完毕，更新moveStartX1的值
          moveStartX1 = moveEndX1;

          /*
              @ 当鼠标画出音轨区域时，选区自动变换
              @ params
                  direction -> 定义终止线运动的方向
                  step -> 定义终止线运动的距离
              @ 注释：startX, endX在调用的过程中随时变换，所以不能通过参数传递的方式传入计时器
           */
          function selectedAreaAutoChange(direction, step) {
              if(direction === 'right') {
                  endX += step;
              }
              if(direction === 'left') {
                  endX -= step;
              }
              if(endX > audioWaveWidth + self.canvasLeftOffset || endX < self.canvasLeftOffset) {
                  // 需要清除选区自动变换计时器
                  clearInterval(selectedAreaAutoChangeInterval); 
              }
              // 选区终边移动到可视区域边缘时，自动滚动滚动条
              self.autoScrolled(endX, 5);
              showSelectedArea(startX, endX, direction);
          }
        });
      });

      // 从音轨区域外进入音轨区域时，取消选区自动变换计时器，并解除window的mousemove事件
      $audioWave.mouseover(function(e){
        // 选区自动变换计时器存在时，取消计时器
        if(selectedAreaAutoChangeInterval) {
            clearInterval(selectedAreaAutoChangeInterval); 
        }
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
            direction -> 选区自动变更时才会传入direction参数
     */
    function showSelectedArea(startX, endX, direction) {
      if(endX == undefined) return;

      startX = XLimit(startX);
      endX = XLimit(endX);

      $selectedArea.removeClass('left-to-left')
        .removeClass('left-to-right')
        .removeClass('right-to-left')
        .removeClass('right-to-right')
        .removeClass('icon iconfont icon-to-left')
        .removeClass('icon iconfont icon-to-right');

      // 当选取的宽度不足时，不显示左右箭头       
      if(Math.abs(startX - endX) >= 20) {
        if(direction == 'right') {
          if(startX > endX) {
              $selectedArea.addClass('left-to-right').addClass('icon iconfont icon-to-right');
          }else {
              $selectedArea.addClass('right-to-right').addClass('icon iconfont icon-to-right');
          }
        }else if(direction == 'left'){
          if(startX > endX) {
              $selectedArea.addClass('left-to-left').addClass('icon iconfont icon-to-left');
          }else {
              $selectedArea.addClass('right-to-left').addClass('icon iconfont icon-to-left');
          }
        }
      }

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
      clearInterval(selectedAreaAutoChangeInterval);

      // 清空选区自动变更时添加的样式
      $selectedArea.removeClass('left-to-left')
        .removeClass('left-to-right')
        .removeClass('right-to-left')
        .removeClass('right-to-right')
        .removeClass('icon iconfont icon-to-left')
        .removeClass('icon iconfont icon-to-right');

      //如果没有选区，取消之前的选取
      if(startX === endX || endX === undefined){
          cancelSelectedArea();
      }
      showSliderBar(startX, endX);
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
            recorder.loadAudio(buffer);
            // save the existedBuffer and put the audio to audio element
            recorder.exportWAV(self.hanldeLoadedOrRecordedAudio.bind(self));

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
        recorder.loadAudio(buffer);
        // save the existedBuffer and put the audio to audio element
        recorder.exportWAV(self.hanldeLoadedOrRecordedAudio.bind(self));   

        // source.buffer = buffer;
        // source.connect(audioContext.destination);
        // source.start();                        
      });
    };
    xhr.send();
  },

  // save the existedBuffer and put the audio to audio element
  hanldeLoadedOrRecordedAudio: function(blob) {
    var self = this;
    // set existedBuffer the current recorded buffer
    var fr = new FileReader();
    fr.onload = function(e) {
      audioContext.decodeAudioData(e.target.result, function(buffer) {
        self.existedBuffer = buffer;        
        // convert duration to ms
        self.duration = Math.round(buffer.duration * 1000);
        console.log(buffer);

        // 录音暂停处理后/加载完成后也触发一次该事件
        self.trigger('recordingPaused');
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

    console.timeEnd('stop record 所需时间为');
  },

  // ****** TO CHECK *****
	startRecording: function() {
		var self = this;

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
    console.log('start recording...');   
	},

	pauseRecording: function() {
		var self = this;
    recorder && recorder.stop();
    self.restImgData = '';
    recorder.exportWAV(self.hanldeLoadedOrRecordedAudio.bind(self));
    console.log('stop recording...');
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

    self.$playCtl.removeClass('audio-pause').addClass('audio-play').attr('tooltips','开始播放')
    	.find('i').removeClass('icon-pause').addClass('icon-play');

    self.$recordCtl.removeClass('disabled').attr('tooltips','开始录音');
    self.initRecordCtl();
    self.$completeCtl.removeClass('disabled').attr('tooltips','完成录音');
    self.initCompleteCtl();

    self.$audioVisualizationArea.removeClass('disabled');    
	},

	pauseAudio: function() {
		var self = this;

    self.$recordedAudio[0].pause();  

    clearInterval(self.moveSliderBarAsPlayInterval);
	},

	completeRecording: function() {
		var self = this;
    // wav to amr file
    self.wav2amr();

    recorder.clear();
	},

	// wav to amr file after recording completed
	wav2amr: function() {
		var self = this;
    console.log('wav to amr...');
    recorder && recorder.exportWAV(self.wavBlob2Amr.bind(self));
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
	},

  uploadAmrFile: function(blob) {
    console.warn('You\'d better give a function named "uploadAmrFile" to RecordingEditor which can upload "blob" to the server!');
  },
  /* uoloadAmrFile example:
    uploadAmrFile: function(blob) {
      var self = this;

      var formdata = new FormData()
      formdata.append('file', blob, new Date().toISOString() + '.amr');

      audioUpload.upload(formdata).done(function(data) {
        var uploadUrl = data.data.audio_url;
        self.trigger('completeRecord', [{'audio_url': uploadUrl}]);
      }).fail(function(error) {
        console.log(error);
      });
    },
  */
 
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

  // ************ TO CHECK *********
  // restRightWidth -> the width form right side which does not redraw
  drawAudioWave: function(audioBuffer, positionPercent, selectedPercent, restRightWidth) {  
    var self = this;
    // if(newRestRightWidth >= 0) {
    //  restRightWidth = newRestRightWidth;
    // }
    var $timeLineCanvas         = self.$timeLine;
    var $audioWaveCanvas        = self.$audioWave;
    var $sliderBar              = self.$sliderBar;

    var beginX       = $audioWaveCanvas.data('beginX');
    var waveWidth    = $audioWaveCanvas.data('waveWidth');
    var canvasWidth  = $audioWaveCanvas.width();
    var canvasHeight = $audioWaveCanvas.height();
    var halfHeight   = canvasHeight / 2;

    var audioChannelData = audioBuffer.getChannelData(0);  
    var sampleRate = audioBuffer.sampleRate;
    var bufferLen = audioChannelData.length;    

    // compute the distance of two wave line(vertical line) 
    var sliceWidth = self.widthPreSecond_px * self.omittedSamplesNum / sampleRate  ;

    var canvasCtx = $audioWaveCanvas[0].getContext('2d');

    var y = 0,
      beginXOffset;
    var newRestRightWidth = 0;
    for(var i = 0; i < bufferLen; i += self.omittedSamplesNum){ 
      // make it to be (int + 0.5)
      beginXOffset = Math.floor(beginX) + 0.5;

      // get imgdata of the right side rest 
      if(restRightWidth != 0) {
        // if(selectedPercent == 0) {
        //  newRestRightWidth = restRightWidth - sliceWidth;
        //  newRestRightWidth = newRestRightWidth < 0 ? 0 : newRestRightWidth;
        //  console.log(newRestRightWidth,'newRestRightWidth')
        // }else {
          newRestRightWidth = restRightWidth;
        // }
        //

        // 本次录音过程中，将restImgData暂存，暂停录音时，reset该值
        if(self.restImgData != '') {
          var restImgData = self.restImgData;
        }else {
          var restImgData = canvasCtx.getImageData(waveWidth - newRestRightWidth + self.canvasLeftOffset , 0, newRestRightWidth, canvasHeight);    
          self.restImgData = restImgData;      
        }

        // clean right canvas
        canvasCtx.clearRect(waveWidth - restRightWidth + self.canvasLeftOffset, 1, restRightWidth, canvasHeight - 2);

        canvasCtx.strokeStyle = self.defaultHLStrokeStyle;
        canvasCtx.lineWidth = self.defaultLineWidth;
        canvasCtx.beginPath();
        // draw the middle line again
        canvasCtx.moveTo(waveWidth - restRightWidth + self.canvasLeftOffset, halfHeight);
        canvasCtx.lineTo(waveWidth - restRightWidth + self.canvasLeftOffset + restRightWidth, halfHeight);
        canvasCtx.stroke();
      } 

      if(beginXOffset + restRightWidth >= (canvasWidth - self.canvasRightOffset) ) {
        // if the width is less than the needed, add self.widthPreSecond_px
        var newCanvasWidth = Math.ceil(beginXOffset + restRightWidth + self.canvasRightOffset + self.widthPreSecond_px);
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

      if(restRightWidth != 0) {
        canvasCtx.putImageData(restImgData, Math.ceil(beginX), 0);
      }

      $sliderBar.css('left', Math.ceil(beginX));
      // scroll perfectScrollbar as the slider-bar move
      self.scrollPerfectScrollbar();

      waveWidth = Math.ceil(beginX + newRestRightWidth - self.canvasLeftOffset);
      $audioWaveCanvas.data('waveWidth', waveWidth);
      restRightWidth = newRestRightWidth
      beginX += sliceWidth;
      
      $audioWaveCanvas.data('beginX', beginX);  
    }
  },

  scrollPerfectScrollbar: function() {
    var self = this;
    var $audioVisualizationArea = self.$audioVisualizationArea;
    var currentScrollLeft = $audioVisualizationArea.scrollLeft();

    var $canvases = $audioVisualizationArea.find('.canvases');  
    var $sliderBar = self.$sliderBar;    
    var canvasesWidth = $canvases.width();
    var sliderBarLeft = parseInt($sliderBar.css('left'));
    var computedScrollLeft = sliderBarLeft - canvasesWidth + this.canvasRightOffset;
    
    if(currentScrollLeft < computedScrollLeft){
      $audioVisualizationArea.scrollLeft(computedScrollLeft);
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

    self.resetDefaultProps();
    // extend must after reset default props 
    $.extend(true, self, config); 

    self.resetRecorder();  
    self.resetRecorderCtls();
    self.resetRecordedArea();
    self.resetAudioVisualizationArea();
  },

  resetDefaultProps: function() {
    var self = this;

    self.hasLoadedAudio = false; 

    // properties in the process of recording
    self.hasRecordedAudio   =  false;
    self.isInsertOrReplace  = false;
    self.existedBuffer      = '';
    self.restImgData        = '';
    self.currentEvent       = undefined;
    self.eventsList         = {};
    self.samplesCount       = 0;
    self.duration           = 0;
  },

  resetRecorder: function() {
    // reset the recorder
    recorder.clear();
  },

  resetRecorderCtls: function() {
    var self = this;
    self.deinitRecorderCtls();
    self.initRecorderCtls();
  },

  deinitRecorderCtls: function () {
    var self = this;
    self.deinitRecordCtl();
    self.deinitPlayCtl();
    self.deinitCompleteCtl();
  }, 

  resetAudioVisualizationArea: function() {
    var self = this;
    var resetCanvasWidth = self.$audioVisualizationArea.width();
    self.audioVisualizationAreaControl('reset', resetCanvasWidth);
  },

  resetRecordedArea: function() {
    var self = this;
    // reset the recorded audio
    self.$recordedAudio.attr('src', '');
    // remove download anchor
    self.$recordedArea.find('a').remove();
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
