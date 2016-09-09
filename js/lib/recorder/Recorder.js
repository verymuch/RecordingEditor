(function(window){
  /*
    监听鼠标点击时间，控制PPT
   */
  var currentEvent = '';
  $(document).click(function(e) {
    console.log(e.type);
    currentEvent = e.type;
  });

  var WORKER_PATH = 'js/libs/Recorder/RecorderWorker.js';

  var Recorder = function(source, cfg){
    var config = cfg || {};
    var bufferLen = config.bufferLen || 4096;
    this.context = source.context;
    this.node = this.context.createScriptProcessor(bufferLen, 2, 2);
    var worker = new Worker(config.workerPath || WORKER_PATH);

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
      RE.drawAudioWave(e.inputBuffer, positionPercent, selectedPercent, restRightWidth);

      worker.postMessage({
        command: 'record',
        currentEvent: currentEvent,
        buffer: [
          e.inputBuffer.getChannelData(0),
          e.inputBuffer.getChannelData(1)
        ]
      });

      currentEvent = undefined;
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

      restRightWidth = restRightWidthTemp;
      positionPercent = positionPercentTemp;
      selectedPercent = selectedPercentTemp;

      // 点击开始录音时，设定本次录音插入的位置
      worker.postMessage({
        command: 'insert',
        positionPercent: positionPercent || 1,
        selectedPercent: selectedPercent || 0
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

    worker.onmessage = function(e){
      if(e.data.exceedLimit){
        $('.recorder-ctl.record')
            .click().unbind('click')
            .addClass('disabled')
            .attr('tooltips','超过最大录音限制');
        $('.audio-visualization-area').addClass('exceed-limit');

        return;
      }
      // var blob = e.data;
      // console.log(blob)
      // currCallback(blob);
      
      console.log(e.data)
      var blob = e.data.audioBlob;
      var events = e.data.eventsList;
      var len = e.data.len;
      console.log(events, events.length, len);
      console.log(blob)
      currCallback(blob);
    }

    source.connect(this.node);
    this.node.connect(this.context.destination);    //this should not be necessary
  };

  Recorder.forceDownload = function(blob, filename){
    var url = (window.URL || window.webkitURL).createObjectURL(blob);
    var link = window.document.createElement('a');
    link.href = url;
    link.download = filename || 'output.wav';
    var click = document.createEvent("Event");
    click.initEvent("click", true, true);
    link.dispatchEvent(click);
  }

  window.Recorder = Recorder;

})(window);
