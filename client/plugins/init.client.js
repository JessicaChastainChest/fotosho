import Vue from 'vue'
Vue.prototype.$isDev = process.env.NODE_ENV !== 'production'

console.log('>>> Init plugin', process.server)

Vue.prototype.$bytesPretty = (bytes, decimals = 2) => {
  if (bytes === 0) {
    return '0 Bytes'
  }
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

function loadImageBlob(uri) {
  return new Promise((resolve) => {
    const img = document.createElement('img')
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    img.onload = ({ target }) => {
      c.width = target.naturalWidth
      c.height = target.naturalHeight
      ctx.drawImage(target, 0, 0)
      c.toBlob((b) => resolve(b), 'image/jpeg', 0.75)
    }
    img.crossOrigin = ''
    img.src = uri
  })
}

Vue.prototype.$downloadImage = async (uri, name) => {
  var blob = await loadImageBlob(uri)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.target = '_blank'
  a.download = name || 'fotosho-image'
  a.click()
}

function isClickedOutsideEl(clickEvent, elToCheckOutside, ignoreSelectors = [], ignoreElems = []) {
  const isDOMElement = (element) => {
    return element instanceof Element || element instanceof HTMLDocument
  }

  const clickedEl = clickEvent.srcElement
  const didClickOnIgnoredEl = ignoreElems.filter((el) => el).some((element) => element.contains(clickedEl) || element.isEqualNode(clickedEl))
  const didClickOnIgnoredSelector = ignoreSelectors.length ? ignoreSelectors.map((selector) => clickedEl.closest(selector)).reduce((curr, accumulator) => curr && accumulator, true) : false

  if (isDOMElement(elToCheckOutside) && !elToCheckOutside.contains(clickedEl) && !didClickOnIgnoredEl && !didClickOnIgnoredSelector) {
    return true
  }

  return false
}

Vue.directive('click-outside', {
  bind: function (el, binding, vnode) {
    let vm = vnode.context;
    let callback = binding.value;
    if (typeof callback !== 'function') {
      console.error('Invalid callback', binding)
      return
    }
    el['__click_outside__'] = (ev) => {
      if (isClickedOutsideEl(ev, el)) {
        callback.call(vm, ev)
      }
    }
    document.addEventListener('click', el['__click_outside__'], false)
  },
  unbind: function (el, binding, vnode) {
    document.removeEventListener('click', el['__click_outside__'], false)
    delete el['__click_outside__']
  }
})

Vue.prototype.$sanitizeFilename = (input, replacement = '') => {
  if (typeof input !== 'string') {
    return false
  }
  var illegalRe = /[\/\?<>\\:\*\|"]/g;
  var controlRe = /[\x00-\x1f\x80-\x9f]/g;
  var reservedRe = /^\.+$/;
  var windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  var windowsTrailingRe = /[\. ]+$/;

  var sanitized = input
    .replace(illegalRe, replacement)
    .replace(controlRe, replacement)
    .replace(reservedRe, replacement)
    .replace(windowsReservedRe, replacement)
    .replace(windowsTrailingRe, replacement);
  return sanitized
}
