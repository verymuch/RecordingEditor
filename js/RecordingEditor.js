(function( window, undefined ) {
var document = window.document,

	version = '0.0.1',

	audioContext,

	recorder,

	moveSliderBarAsPlayInterval,

	RecordingEditor = function( config ) {
		return new RecordingEditor.prototype.init( config );
	};

RecordingEditor.prototype = {

	version: version,

	constructor: RecordingEditor,

	// default properties associated with canvas
	canvasLeftOffset: 20,
	canvasRightOffset: 30,

	widthPreSecond_px: 60,
	pointsCountPreSecond: 10,

	omittedSamplesNum: 256,

	defaultStrokeStyle: '#444',
	defaultHLStrokeStyle: '#666',
	defaultTextFillStyle: '#fff',
	defaultFont: '10px April',
	defaultLineWidth: 1,
	defaultWaveStrokeStyle: '#666',
	modifiedWaveStrokeStyle: 'rgb(220,0,0)',

	// properties associated with loaded audio
	hasLoadedAudio: true,
	loadedAudioURL: 'audio/ddd.amr',
	hasRecordedAudio: false,

	isInsertOrReplace: false,
	existedBuffer: '',

	currentEvent: undefined,

	eventsList: [],

	sampleCounts: 0,

	WORKER_PATH: 'js/lib/recorder/RecorderWorker.js',

  init: function( config ) {
    var self = this;
    // extend(merge) the config to default properties
    $.extend(true, self, config);   

    self.DOMInit();

    self.recorderInit();

    self.recorderCtlsInit();
    
    self.tooltipsInit();

    self.audioVisualizationAreaInit();

    self.selectionInit();

    // load amr from server
    if(self.hasLoadedAudio) {
      self.amrVisualization();
    }

    // resize the visualization area when the window is changed
    self.visualizationAreaResizeCtl();

    return self;
  },

	// self -> this RecordingEditor
	Recorder: function(source, cfg, self){
		var self = self;
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

      restRightWidth = restRightWidthTemp || 0;
      positionPercent = positionPercentTemp || 0;
      selectedPercent = selectedPercentTemp || 0;

      console.log(positionPercent, selectedPercent, restRightWidth);

      // 点击开始录音时，设定本次录音插入的位置
      worker.postMessage({
        command: 'insert',
        positionPercent: positionPercent,
        selectedPercent: selectedPercent || 0
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

      console.log(e.data)
      var blob = e.data.audioBlob;
      var events = e.data.eventsList;
      var len = e.data.len;
      self.eventsList = events;
      self.sampleCounts = len;

      console.log('事件列表', events, events.length, len);
      console.log(blob)

      currCallback(blob);
    }

    source.connect(this.node);
    this.node.connect(this.context.destination);    //this should not be necessary
  },

  addEvents: function(eventType) {
  	var self = this;
  	self.currentEvent = eventType;
  },

  reset: function(config) {
    var self = this;

    $.extend(true, self, config);   

    self.recorderCtlsUninit();
    self.recorderCtlsInit();
    
    self.audioVisualizationAreaReset();

    // load amr from server
    if(self.hasLoadedAudio) {
      self.amrVisualization('reset');
    }
  },

	DOMInit: function() {
		var self = this;

		// insert rootDOM to the specific $insertElement
		self.rootDOM = self.$RecordingEditor = $('<div/>')
			.addClass('recording-editor')
			.appendTo(self.$insertElement);

		// record ctls
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
		var recordedAreaClassName = 'recorded-area' + (self.showRecordedArea ? '' : ' hide');
    self.$recordedArea = $('<div/>')
			.addClass(recordedAreaClassName)
			.appendTo(self.$RecordingEditor);

    if(!self.showRecordedArea) {

    }

		self.$recordedAudio = $('<audio/>')
			.addClass('recorded-audio')
			.attr('controls',true)
			.appendTo(self.$recordedArea);
	},

	recorderInit: function() { 
		var self = this;
    // audiocontext init, userMedia init
    try {
        // shim
        window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;

        //从设备获取摄像头、话筒
        navigator.getUserMedia = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);

        window.URL = window.URL || window.webkitURL || window.mozURL;

				// 创建好音频上下文
        audioContext = new AudioContext();

        console.log('AudioContext set up!');
        console.log('navigator.getUserMedia ' + (navigator.getUserMedia ? 'supported' : 'not supported') + '!');

    }catch (e) {
        console.log('Web audio API is not supported in this browser');
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
		console.log(self)
    var inputStream = audioContext.createMediaStreamSource(stream);

    recorder = new self.Recorder(inputStream, {}, self);

    console.log('record inited!');
	},

	recorderCtlsInit: function () {
		var self = this;

    self.recordStartCtlInit();
    self.audioPlayCtlInit();
    self.recordCompleteCtlInit();
	},

  recorderCtlsUninit: function () {
    var self = this;

    self.recordStartCtlUninit();
    self.audioPlayCtlUninit();
    self.recordCompleteCtlUninit();
  },

	recordStartCtlInit: function() {
		var self = this;
    
    self.$recordCtl.attr('tooltips','录音').click(function() {
      if($(this).hasClass('record-start')) {
        // change style and content
        $(this).removeClass('record-start').addClass('record-pause').attr('tooltips','停止')
        	.find('i').removeClass('icon-record').addClass('icon-pause');

        // limit
        self.$playCtl.addClass('disabled').attr('tooltips', '录制中，无法播放');
        self.audioPlayCtlUninit();
        self.$completeCtl.addClass('disabled').attr('tooltips', '录制中，无法保存');
        self.recordCompleteCtlUninit();

        // no operation in visualization-area
      	self.$audioVisualizationArea.addClass('disabled');

      	self.startRecording();
      }else if($(this).hasClass('record-pause')) {
        self.hasRecordedAudio = true;
        // change style and content
        $(this).removeClass('record-pause').addClass('record-start').attr('tooltips','录制')             
        	.find('i').removeClass('icon-pause').addClass('icon-record');

        // remove limit
        // audio play limit will be removed after the process of recorded audio
        self.$completeCtl.removeClass('disabled').attr('tooltips','完成并保存');
        self.recordCompleteCtlInit();

        // no operation in visualation-area
        self.$audioVisualizationArea.removeClass('disabled');

        console.time('stop record 所需时间为');
        
        self.stopRecording();
      }
    });
	},

	recordStartCtlUninit: function() {
	  this.$recordCtl.unbind('click');
	},

	audioPlayCtlInit: function() {
		var self = this;
    if( !(self.hasLoadedAudio || self.hasRecordedAudio) ) {
        self.$playCtl.addClass('disabled').attr('tooltips','暂无可播放音频');
        return;
    }

    self.$playCtl.attr('tooltips','播放').click(function() {
        if($(this).hasClass('audio-play')) {
            
            $(this).removeClass('audio-play').addClass('audio-pause').attr('tooltips','停止')
            	.find('i').removeClass('icon-play').addClass('icon-pause');

            // limit
            self.$recordCtl.addClass('disabled').attr('tooltips', '播放中，无法录制');
            self.recordStartCtlUninit();
            self.$completeCtl.addClass('disabled').attr('tooltips', '播放中，无法保存');
            self.recordCompleteCtlUninit();

            self.$audioVisualizationArea.addClass('disabled');

            self.recordedAudioPlay();

        }else if($(this).hasClass('audio-pause')) {

            $(this).removeClass('audio-pause').addClass('audio-play').attr('tooltips','播放')
            	.find('i').removeClass('icon-pause').addClass('icon-play');

            self.$recordCtl.removeClass('disabled').attr('tooltips','录制');
            self.recordStartCtlInit();
            self.$completeCtl.removeClass('disabled').attr('tooltips','完成并保存');
            self.recordCompleteCtlInit();

            self.$audioVisualizationArea.removeClass('disabled');

            self.recordedAudioPause();
        }
    });
	},

	audioPlayCtlUninit: function() {
	  this.$playCtl.unbind('click');
	},

	recordCompleteCtlInit: function() {
		var self = this;
    self.$completeCtl.attr('tooltips','完成并保存').click(function() {
        // self.$RecordingEditor.hide();
        self.completeRecording();
    });
	},

	recordCompleteCtlUninit: function() {
    this.$completeCtl.unbind('click');
	},

	startRecording: function() {
		var self = this;

    var $audioWave = self.$audioWave;
    var $selectedArea = self.$selectedArea;
    var $sliderBar = self.$sliderBar;

    var waveWidth = $audioWave.data('waveWidth');
    var selectedAreaWidth = $selectedArea.width();

    /* - self.canvasLeftOffset to compute the position in actural wave */
    if(selectedAreaWidth != 0) {
      // the position of slider-bar maybe changed when it is played in selected area
      // so the recordBeginX is left side of the selected area
      var recordBeginX = parseInt($selectedArea.css('left')) - self.canvasLeftOffset;
    }else {
      var recordBeginX = parseInt($sliderBar.css('left')) - self.canvasLeftOffset;
    } 

    var restRightWidth = waveWidth - recordBeginX - selectedAreaWidth;

    var positionPercent = recordBeginX / waveWidth;
    var selectedPercent = selectedAreaWidth / waveWidth || 0;

    // change the isInsertOrReplace to true when first insert or replace
    if( restRightWidth != 0 || selectedAreaWidth !=0 ) {
    	self.isInsertOrReplace = true;
    }

    // process exist buffer 
    // to make the drawed buffer use the same color
    if(self.existedBuffer && self.isInsertOrReplace) {
      // re init audio wave canvas
      // ****************** Is it needed???? **********************
      var visualizationAreaScrollWidth = self.$audioVisualizationArea[0].scrollWidth;
      self.audioVisualizationAreaControl('update', visualizationAreaScrollWidth);

      // redraw existBuffer
      self.drawExistedOrLoadedAudioWave(self.existedBuffer);

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

	stopRecording: function() {
		var self = this;

    recorder && recorder.stop();
    recorder.exportWAV(self.recordedAudioHandle.bind(self));

    console.log('stop recording...');
	},

	/*
	    @ put the record audio to audio element
	 */
	recordedAudioHandle: function(blob) {
		var self = this;

    // set existedBuffer the current recorded buffer
    var fr = new FileReader();
    fr.onload = function(e) {
        audioContext.decodeAudioData(e.target.result, function(buffer) {
            self.existedBuffer = buffer;
            console.log(buffer);
        }, function(e) {
            console.warn(e);
        });
    }
    fr.readAsArrayBuffer(blob);

    var url = URL.createObjectURL(blob);

    var $recordedAudio = self.$recordedAudio;

    $recordedAudio.attr('src', url);

    // *************to be delete*******************************************************************
    $recordedAudio.attr('controls', true);

    // should make sure the recorded audio in the audio element, then init play
    self.$playCtl.removeClass('disabled').attr('tooltips','播放');
    this.audioPlayCtlUninit();
    this.audioPlayCtlInit();

    console.timeEnd('stop record 所需时间为');
	},

	recordedAudioPlay: function() {
		var self = this;
    var $recordedAudio = self.$recordedAudio;

    var $audioWave = self.$audioWave;
    var $selectedArea = self.$selectedArea;
    var $sliderBar = self.$sliderBar;

    var waveWidth = $audioWave.data('waveWidth');
    var selectedAreaWidth = $selectedArea.width();
    var duration = $recordedAudio[0].duration;

    /* 所有与播放给相关的位置去掉左右侧缺省位置 */
    // 初始化播放开始位置，去掉左侧默认缺省位置
    var playBeginX = parseInt($sliderBar.css('left')) - self.canvasLeftOffset;

    // play的范围，playFrom--播放起始位置/playTo--播放结束位置
    var playFrom, playTo;

    // 播放的截止时间
    var endedTime;

    // 如果存在选区，设定播放范围
    if(selectedAreaWidth != 0) {
        playFrom = parseInt($selectedArea.css('left')) - self.canvasLeftOffset;
        playTo = playFrom + selectedAreaWidth;
        endedTime = playTo / waveWidth * duration;

        // $recordedAudio[0].addEventListener('timeupdate', self.playTimeupdateHandle(endedTime), false);
        $recordedAudio.bind('timeupdate', self.playTimeupdateHandle(endedTime));
    }else {
    // 如果不存在选区，设定默认播放范围
        playFrom = 0;
        playTo = waveWidth;

        // 非选区播放结束时，暂停按钮变回播放
        // $recordedAudio.addEventListener('ended', self.playEndedHandle.bind(self), false);
        $recordedAudio.bind('ended', self.playEndedHandle.bind(self));
    }

    // 如果开始位置在播放结束位置，调整至开头（类循环播放）
    if(playBeginX == playTo){
        playBeginX = playFrom;
        // 并将slider-bar的位置放在开始位置
        $sliderBar.css('left', playFrom + self.canvasLeftOffset);
    }
    // 确认好开始位置后计算currentTime
    var currentTime = playBeginX / waveWidth * duration || 0;

    // 设定当前播放时间，并播放
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
    // 随着播放移动slider-bar
    moveSliderBarAsPlayInterval = setInterval(function() {
        self.moveSliderBarAsPlay(playFrom, playTo, 1);
        // 根据moveSliderBarAsPlay中最后一个参数offset的值来计算interval时间。
    }, 1000 / self.widthPreSecond_px);
	},

	/*
	    @ 播放音频时，slider-bar随动
	    @ params
	        playFrom -> 播放开始的位置
	        playTo -> 播放结束的位置
	        offset -> left每次移动 offset
	 */
	moveSliderBarAsPlay: function(playFrom, playTo, offset) {
    var self = this;
    var $sliderBar = self.$sliderBar;
    var waveWidth = self.$audioWave.data('waveWidth');
    var left = parseInt($sliderBar.css('left'));

    left += offset;
    // 播放范围内进行slider-bar的移动，不能移出范围
    if( left <= playTo + self.canvasLeftOffset){
        $sliderBar.css('left', left);
        self.autoScrolled(left, 50);
    }    
	},

	/*
	    @ 选区播放音频时，监听的timeupdate 函数
	    @ params
	        endedTime -> 结束时间
	 */
	playTimeupdateHandle: function(endedTime) {
		var self = this;
    return function listenerHandle(){
      var currentTime = self.$recordedAudio[0].currentTime;
      if(currentTime >= endedTime){
        // 播放到结束时间时，暂停并取消timeupdate事件
        $(this)[0].pause();

        // 结束音频后，重置控制区样式等
        self.playEndedReset();

        // 移除timeupdate事件监听
        // $recordedAudio[0].removeEventListener('timeupdate', listenerHandle, false);
        self.$recordedAudio.unbind('timeupdate');
      }
    }
	},

	/*
	    @ 无选区播放音频结束时的事件处理函数
	 */
	playEndedHandle: function() {
		var self = this;
    // 结束视频后，重置控制区样式
    self.playEndedReset();

    // 结束后取消监听ended事件，防止重复绑定
    // $recordedAudio[0].removeEventListener('ended', this.playEndedHandle.bind(this), false);
    self.$recordedAudio.unbind('ended');
	},

	/*
	    @ 结束播放后，重置控制区样式等
	 */
	playEndedReset: function() {
		var self = this;

    var $recordedAudio = self.$recordedAudio;

    // 取消移动slider-bar的定时器
    clearInterval(moveSliderBarAsPlayInterval);

    // 样式变更
    self.$playCtl.removeClass('audio-pause').addClass('audio-play').attr('tooltips','播放')
    	.find('i').removeClass('icon-pause').addClass('icon-play');

    //播放停止后，移除disabled限制
    self.$recordCtl.removeClass('disabled').attr('tooltips','录制');
    self.recordStartCtlInit();
    self.$completeCtl.removeClass('disabled').attr('tooltips','完成并保存');
    self.recordCompleteCtlInit();

    // 可视化区域不可操作
    self.$audioVisualizationArea.removeClass('disabled');    
	},

	/*
	    @ 暂停播放录制的音频
	 */
	recordedAudioPause: function() {
		var self = this;

    // 暂停音频的播放
    self.$recordedAudio[0].pause();  

    // 取消移动slider-bar的定时器
    clearInterval(moveSliderBarAsPlayInterval);
	},

	/*
	    @ 完成录音
	 */
	completeRecording: function() {
		var self = this;
    // wav to amr文件
    self.wav2amr();

    recorder.clear();
	},

	/*
	    @ 录音完成，将音频文件转为amr文件 wav to amr
	 */
	wav2amr: function() {
		var self = this;
    console.log('wav to amr...');
    recorder && recorder.exportWAV(self.wavBlobConvertToAmr.bind(self));
	},

	/*
	    @ 将录音器导出的wavBlob转存为amr
	    ----------------review--------------------------------
	 */
	wavBlobConvertToAmr: function(blob) {
		var self = this;
    //暂时保留，提供wav文件的下载链接
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

            // 下载转换的amr文件
            self.handleAMR(new Blob([amr], {type: 'datatype/sound'}));
        });
    });
	},

	/*
	    @ 读取blob数据
	    @params 
	        blob -> blob数据
	        callback -> 回调函数
	 */
	readBlob: function(blob, callback) {
    var reader = new FileReader();
    reader.onload = function(e) {
        var data = new Uint8Array(e.target.result);
        callback(data);
    };
    reader.readAsArrayBuffer(blob);
	},

	/*
	    @ 提供amr文件的下载链接
	 */
	handleAMR: function(blob) {
		var self = this;
    var url = URL.createObjectURL(blob);

    self.$amrDownloadAnchor = $('<a/>').appendTo(self.$recordedArea);

    // 初始化下载链接
    self.$amrDownloadAnchor
    	.attr('href', url)
    	.html('点击下载amr文件')
    	.attr('download', new Date().toISOString() + '.amr');
	},

	/*
	    @ 提供wav文件的下载链接
	 */
	handleWAV: function(blob) {
		var self = this;
    var url = URL.createObjectURL(blob);

    self.$wavDownloadAnchor = $('<a/>').appendTo(self.$recordedArea);;

    // 初始化下载链接
    self.$wavDownloadAnchor
    	.attr('href', url)
    	.html('点击下载wav文件')
    	.attr('download', new Date().toISOString() + '.wav');
	},

	/*
	    @ 加载amr文件，并可视化
	 */
	amrVisualization: function(isReset) {
		var self = this;

    console.log('arm file visualization...');
    /*一个新的 XHR 对象 */
    var xhr = new XMLHttpRequest();
    /* 通过 GET 请连接到 .mp3 */
    xhr.open('GET', self.loadedAudioURL, true);
    /* 设置响应类型为字节流 arraybuffer */
    xhr.responseType = 'blob';

    xhr.onload = function() {
      self.readBlob(xhr.response, function(data) {
        console.time('amr文件解码时间');
        var buffer = AMR.toWAV(data);
        console.timeEnd('amr文件解码时间');
        var blob = new Blob([buffer], { type: 'audio/wav' });

        var fr = new FileReader();
        var source = audioContext.createBufferSource();
        fr.onload = function(e) {
          audioContext.decodeAudioData(e.target.result, function(buffer) {
            console.time('加载音频可视化时间');
            self.drawExistedOrLoadedAudioWave(buffer, isReset);
            console.timeEnd('加载音频可视化时间');

            /* 将 buffer 传入解码 AudioBuffer. */
            source.buffer = buffer;
            console.log(buffer);

            // 将加载的音频buffer传入recorder,并将音频放入可播放标签
            recorder.loadAudio(buffer);
            // 存为全局变量，窗口大小改变时，变更canvas使用
            // self.existedBuffer = buffer;
            // 该语句省略，exportWAV中包括了该内容。
            recorder.exportWAV(self.recordedAudioHandle.bind(self));

            source.connect(audioContext.destination);
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

	// ---------------加载wav文件，待删除----------------------------------
	/*
	    @ 加载wav文件，并可视化
	 */
	wavVisualization: function() {
		var self = this;
    console.log('wav file visualization...');
    // 加载编码之后解码的wav文件
    /*一个新的 XHR 对象 */
    var xhr = new XMLHttpRequest();
    /* 通过 GET 请连接到 .mp3 */
    xhr.open('GET', 'audio/tomorrow.wav', true);
    /* 设置响应类型为字节流 arraybuffer */
    xhr.responseType = 'arraybuffer';

    xhr.onload = function() {
        source = audioContext.createBufferSource();
        audioContext.decodeAudioData(xhr.response, function(buffer) {
            self.drawExistedOrLoadedAudioWave(buffer);
            /* 将 buffer 传入解码 AudioBuffer. */
            source.buffer = buffer;
            source.connect(audioContext.destination);
            // source.start();                          
        });
    };
    xhr.send();
	},

	/*** audio visualization area ***/
	audioVisualizationAreaInit: function() {
		var self = this;
    // var initCanvasWidth = self.$audioVisualizationArea[0].scrollWidth;
    var initCanvasWidth = self.$audioVisualizationArea.width();
		self.audioVisualizationAreaControl('init', initCanvasWidth);
	},

  audioVisualizationAreaReset: function() {
    var self = this;
    var resetCanvasWidth = self.$audioVisualizationArea.width();

    // reset audio wave canvas's data
    self.$sliderBar.css('left', self.canvasLeftOffset);
    self.$audioWave.data({
      'beginX': self.canvasLeftOffset,
      'waveWidth': 0
    });

    // reset the recorded audio
    self.$recordedAudio.attr('src', '');
    
    // reset the recorder
    recorder.clear();

    self.audioVisualizationAreaControl('reset', resetCanvasWidth);

  },

	audioVisualizationAreaControl: function(psCtl, canvasWidth) {
		var self = this;
		var audioVisualizationArea = self.$audioVisualizationArea[0];	

		self.canvasesInit(canvasWidth);
		if(psCtl == 'init') {
			Ps.initialize(audioVisualizationArea);
		}else if(psCtl == 'update') {
			Ps.update(audioVisualizationArea);
		}else if(psCtl == 'reset') {
      Ps.destroy(audioVisualizationArea);
      Ps.initialize(audioVisualizationArea);   
      self.$audioVisualizationArea.scrollLeft(0);   
    }
	},

	canvasesInit: function(canvasWidth){
		var self = this;
    self.timeLineInit(canvasWidth);
    self.audioWaveInit(canvasWidth);
	},

	timeLineInit: function (canvasWidth) {
		var self = this;
		var $timeLineCanvas = self.$timeLine;
		/*
			notice：the canvas will be clean, if the width is reset
		*/
		$timeLineCanvas[0].width = canvasWidth;
    $timeLineCanvas.width(canvasWidth);

		var timeLineHeight	= $timeLineCanvas.height();

		// should better to be a integer
		var widthPrePoint 		= self.widthPreSecond_px / self.pointsCountPreSecond;
		var computedPointsCount = (canvasWidth - self.canvasLeftOffset - self.canvasRightOffset) / self.widthPreSecond_px * self.pointsCountPreSecond;
		var ceilPointsCount 	= Math.ceil(computedPointsCount);

		// beginX + 0.5 is to make the canvas line clear
		var beginX = self.canvasLeftOffset + 0.5;

		var timeLineCtx		= $timeLineCanvas[0].getContext('2d');
		timeLineCtx.strokeStyle = self.defaultStrokeStyle;
		timeLineCtx.fillStyle 	= self.defaultTextFillStyle;
		timeLineCtx.font 		= self.defaultFont;
		timeLineCtx.lineWidth 	= self.defaultLineWidth;
		
		timeLineCtx.beginPath();
		for(var i = 0; i <= ceilPointsCount; i++) {
	    timeLineCtx.moveTo(beginX, timeLineHeight);

	    // draw formatted secends
	    if(i % self.pointsCountPreSecond == 0) {
	        timeLineCtx.lineTo(beginX, 0);
	        timeLineCtx.fillText(self.formatTime(i/self.pointsCountPreSecond), beginX + 2, 12);
	    }else {
	        timeLineCtx.lineTo(beginX, 15);
	    }

	    beginX += widthPrePoint;
		}
		timeLineCtx.stroke();
	},

	audioWaveInit: function(canvasWidth) {
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
    audioWaveCtx.strokeStyle = self.defaultStrokeStyle;
    audioWaveCtx.lineWidth = self.defaultLineWidth;

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

	formatTime: function(s){
		// s show be less than 3600
    if(s >= 3600) return '00:00';

    var minites = Math.floor(s / 60);
    var formatMinites = minites < 10 ? '0' + minites : minites.toString(10);

    var seconds = s - minites * 60;
    var formatSeconds = seconds < 10 ? '0' + seconds : seconds.toString(10);

    var formatTime = formatMinites + ':' + formatSeconds;

    return formatTime;
	},

	/*
		@ draw audio wave
		@params 
			audioBuffer -> audio buffer to draw
			restRightWidth -> the width form right side which does not redraw
	 */
	drawAudioWave: function(audioBuffer, positionPercent, selectedPercent, restRightWidth) {	
		var self = this;
		// if(newRestRightWidth >= 0) {
		// 	restRightWidth = newRestRightWidth;
		// }
		var $timeLineCanvas = self.$timeLine;
		var $audioWaveCanvas = self.$audioWave;
		var $sliderBar = self.$sliderBar;

		var beginX 		 = $audioWaveCanvas.data('beginX');
		var waveWidth 	 = $audioWaveCanvas.data('waveWidth');
		var canvasWidth  = $audioWaveCanvas.width();
		var canvasHeight = $audioWaveCanvas.height();
		var halfHeight 	 = canvasHeight / 2;

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
	    	// 	newRestRightWidth = restRightWidth - sliceWidth;
	    	// 	newRestRightWidth = newRestRightWidth < 0 ? 0 : newRestRightWidth;
	    	// 	console.log(newRestRightWidth,'newRestRightWidth')
	    	// }else {
	    		newRestRightWidth = restRightWidth;
	    	// }

	    	var restImgData = canvasCtx.getImageData(waveWidth - newRestRightWidth + self.canvasLeftOffset , 0, newRestRightWidth, canvasHeight);
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

	      	self.canvasResize(newCanvasWidth);
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
      self.scrollPS();

      waveWidth = Math.ceil(beginX + newRestRightWidth - self.canvasLeftOffset);
      $audioWaveCanvas.data('waveWidth', waveWidth);
      restRightWidth = newRestRightWidth
      beginX += sliceWidth;
      
      $audioWaveCanvas.data('beginX', beginX);	
		}
	},

	drawExistedOrLoadedAudioWave: function(audioBuffer, isReset /* 表明组件是否reset,为string类型 */) {
		var self = this;
    var isReset = isReset || undefined;
		var $timeLineCanvas = self.$timeLine;
		var $audioWaveCanvas = self.$audioWave;
		var $sliderBar = self.$sliderBar;

		var beginX 		 = $audioWaveCanvas.data('beginX');
		var waveWidth 	 = $audioWaveCanvas.data('waveWidth');
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
		// if reset do this if
    if(isReset || (computedCanvasWidth > audioVisualizationAreaWidth)) {
      if(isReset) {
        self.audioVisualizationAreaControl('reset', Math.ceil(computedCanvasWidth));
      }else {
        self.audioVisualizationAreaControl('update', Math.ceil(computedCanvasWidth));
      }
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

	scrollPS: function() {
		var self = this;
		var $audioVisualizationArea = self.$audioVisualizationArea;
		var $canvases = $audioVisualizationArea.find('.canvases');	
		var $sliderBar = self.$sliderBar;
		
		var currentScrollLeft = $audioVisualizationArea.scrollLeft();
		
		var canvasesWidth = $canvases.width();
		var sliderBarLeft = parseInt($sliderBar.css('left'));
		var computedScrollLeft = sliderBarLeft - canvasesWidth + this.canvasRightOffset;

		var retScrollLeft = currentScrollLeft < computedScrollLeft ? computedScrollLeft : currentScrollLeft;

		$audioVisualizationArea.scrollLeft(retScrollLeft);
	},

	canvasResize: function(width) {
		var self = this;
		var $audioWave = self.$audioWave;
		
		/* step as follows in order */
    // copy image data
    var audioWaveCtx = $audioWave[0].getContext('2d');
    var currentImgData = audioWaveCtx.getImageData(0, 0, $audioWave[0].width, $audioWave[0].height);
    // update width
    self.audioVisualizationAreaControl('update', width);
    // put image data
    audioWaveCtx.putImageData(currentImgData, 0, 0);	
	},

	/*
	    @ 音轨选区控制------包括进度条起始位置的选取，选区的选取
	 */
	selectionInit: function() {
		var self = this;
    var $window = $(window);
    var $audioWave = self.$audioWave;
    var $sliderBar = self.$sliderBar;
    var $selectedArea = self.$selectedArea;

    // 现有音轨的宽度
    var audioWaveWidth;

    // 选区自动变换计时器
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

	/*
	    @ 选区终边移动到可视区域边缘时，自动滚动滚动条 / 也可以用于slider-bar移动时，自动滚动
	    @ params 
	        endX -> 终边的X轴位置
	        offset -> 距离边界的多大距离开始scroll
	 */
	autoScrolled: function(endX, offset) {
	    var self = this;

	    var $audioVisualizationArea = self.$audioVisualizationArea;
	    var scrollLeft = $audioVisualizationArea.scrollLeft();
	    var visualWidth = $audioVisualizationArea.width();

	    if(endX + offset >= scrollLeft + visualWidth) {
	      $audioVisualizationArea.scrollLeft(endX + offset  - visualWidth);
	    }else if(endX - offset <= scrollLeft) {
	      $audioVisualizationArea.scrollLeft(endX - offset);
	    }
	},

	/*
	    @ tooltips初始化
	 */
	tooltipsInit: function() {
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

	/*
	    @ 当窗口大小发生变化时，可视区域更新
	 */
	visualizationAreaResizeCtl: function() {
		var self = this;
    $(window).resize(function() {
      console.log('visualization area resize...');
      var $audioVisualizationArea = $('.audio-visualization-area');

      var waveWidth = $('.audio-wave').data('waveWidth');
      var visualizationWidth = $audioVisualizationArea.width();
      // var visualizationAreaScrollWidth = $audioVisualizationArea[0].scrollWidth;
      // 音轨宽度+左右间距 大于可视区域宽度时
      if(waveWidth + self.canvasLeftOffset + self.canvasRightOffset > visualizationWidth ) {
          self.audioVisualizationAreaControl('update', waveWidth + self.canvasLeftOffset + self.canvasRightOffset);
      }else {
      // 音轨区域+左右间距 小于可视区域宽度
          self.audioVisualizationAreaControl('update', visualizationWidth);
      }
      if(self.existedBuffer) {
          // 需要用到recorder 必须放在该变量定义之后
          self.drawExistedOrLoadedAudioWave(self.existedBuffer);
      }
    });
	}

};

RecordingEditor.prototype.init.prototype = RecordingEditor.prototype;

window.RE = window.RecordingEditor = RecordingEditor;

})(window);
