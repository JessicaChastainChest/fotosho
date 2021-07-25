const Path = require('path')
const FastSort = require('fast-sort')
const Logger = require('./Logger')
const { moveFile } = require('./utils/fileHelpers')
const { stringHash } = require('./utils')

class Gallery {
  constructor(THUMBNAIL_PATH, db, emitter) {
    this.ThumbnailPath = THUMBNAIL_PATH
    this.emitter = emitter
    this.db = db

    this.ThumbnailFormat = 'webp'

    this.photosOrderBy = null
    this.photosOrderDesc = false
  }

  get photos() {
    return this.db.photos
  }
  get albums() {
    return this.db.albums
  }

  getPhotosSortedFiltered(filters, orderBy, orderDesc) {
    var _photos = this.photos
    if (orderBy) {
      if (orderDesc) {
        _photos = FastSort.sort(_photos).desc(a => a[orderBy])
      } else {
        _photos = FastSort.sort(_photos).asc(a => a[orderBy])
      }
    }

    var album = filters.album || null
    var search = filters.search || null

    _photos = _photos.filter(photo => {
      if (album && (!album.photos || !album.photos.includes(photo.id))) {
        return false
      }
      if (search && (!photo.basename || !photo.basename.includes(search))) {
        return false
      }
      return true
    })

    return _photos
  }

  getPhotosFromQuery(query) {
    var albumId = query.album
    var orderBy = query.orderBy || 'birthtime'
    var orderDesc = query.orderDesc === '1'
    var filters = {
      album: null,
      search: query.search || null
    }
    if (albumId) {
      filters.album = this.albums.find(a => String(a.id) === albumId)
    }
    return this.getPhotosSortedFiltered(filters, orderBy, orderDesc)
  }

  fetch(req, res) {
    var start = req.query.s
    start = isNaN(start) ? 0 : Number(start)
    var qty = req.query.qty
    qty = isNaN(qty) ? 25 : Number(qty)
    var photos = this.getPhotosFromQuery(req.query)

    var end = start + qty
    end = end < photos.length ? end : photos.length
    photos = photos.slice(start, end)

    res.json({
      status: 'success',
      photos
    })
  }

  getPhotoByIndex(req, res) {
    var index = req.params.index
    var photos = this.getPhotosFromQuery(req.query)
    if (!photos[index]) {
      return res.sendStatus(404)
    }
    res.json(photos[index])
  }

  getAlbumCover(req, res) {
    var placeholder = Path.resolve(global.appRoot, './static/Logo.png')

    var id = req.params.id
    var album = this.albums.find(a => String(a.id) === id)
    if (!album || !album.photos || !album.photos.length) {
      return res.sendFile(placeholder)
    }
    var photos_in_album = this.photos.filter(p => (album.photos && album.photos.includes(p.id)))
    var photo = photos_in_album.find(p => p.thumbPath)

    if (!photo) {
      Logger.error('No photo has thumbPath')
      return res.sendFile(placeholder)
    }
    var thumbPath = photo.thumb.fullPath
    res.sendFile(thumbPath)
  }

  downloadPhoto(req, res) {
    var photoId = req.params.id
    if (photoId.includes('.jpg')) photoId.replace('.jpg', '')
    var photo = this.photos.find(p => String(p.id) === photoId)
    Logger.info('download photo', req.params.id, photo)
    if (!photo) {
      return res.sendStatus(404)
    }
    res.sendFile(photo.fullPath)
  }

  async addToAlbum(socket, data) {
    Logger.info('addToAlbum', data)
    var photos = data.photos || [data.photoId]
    var albumId = data.albumId
    var album = this.albums.find(a => a.id === albumId)
    if (!album) {
      Logger.error('Album not found', albumId)
      socket.emit('album_not_found', albumId)
      return
    }

    // Only add photos not already in album
    var photos_to_add = photos.filter(pid => !album.photos.includes(pid))
    if (!photos_to_add.length) {
      return
    }
    var photoObjects = photos_to_add.map(p => this.photos.find(ph => ph.id === p))
    album.photos = album.photos.concat(photos_to_add)
    await this.db.updateAlbum(album)
    this.emitter('added_to_album', { photos: photoObjects, album })
  }

  async addToNewAlbum(socket, data) {
    var photos = data.photos || [data.photoId]
    var newAlbumName = data.albumName
    var newAlbumId = stringHash(newAlbumName)
    Logger.info('New Album ID', newAlbumId)
    var newAlbum = {
      id: newAlbumId,
      recordType: 'album',
      name: newAlbumName,
      photos: photos,
      created_at: Date.now(),
      created_by: 'unknown'
    }
    this.db.insertAlbum(newAlbum)

    var photoObjs = this.photos.filter(p => photos.includes(p.id))
    this.emitter('added_to_album', { photos: photoObjs, album: newAlbum })
  }

  async removeFromAlbum(socket, data) {
    var photos = data.photos || [data.photoId]
    var albumId = data.albumId
    var album = this.albums.find(a => String(a.id) === albumId)
    if (!album) {
      Logger.error('Album not found', albumId)
      socket.emit('album_not_found', albumId)
      return
    }

    var photos_in_album = photos.filter(pid => album.photos.includes(pid))
    if (!photos_in_album.length) {
      Logger.error('Photos not in album', photos)
      return
    }
    var photoObjects = photos_in_album.map(p => this.photos.find(ph => ph.id === p))
    album.photos = album.photos.filter(pid => !photos.includes(pid))
    await this.db.updateAlbum(album)
    this.emitter('removed_from_album', { photos: photoObjects, album })
  }

  async deleteAlbum(socket, { albumId }) {
    var albumCopy = this.albums.find(a => String(a.id) === albumId)
    if (!albumCopy) {
      socket.emit('album_not_found', albumId)
      return
    }
    albumCopy = { ...albumCopy }
    await this.db.removeAlbum(albumCopy.id)
    this.emitter('album_deleted', { album: albumCopy })
  }

  async renamePhoto(socket, { photoId, newName }) {
    Logger.info('Rename photo called', photoId, newName)
    var photo = this.photos.find(p => String(p.id) === String(photoId))
    if (!photo) {
      Logger.info('Photo not found', photoId)
      socket.emit('photo_not_found', photoId)
      return
    }

    var newBasename = `${newName}.${photo.ext}`
    var dirname = Path.dirname(photo.fullPath)
    var newFilepath = Path.join(dirname, newBasename)

    Logger.info('calling move', photo.fullPath, 'to', newFilepath)
    var successful = await moveFile(photo.fullPath, newFilepath)
    this.emitter('rename_photo_result', {
      photoId: photo.id,
      from: photo.fullPath,
      to: newFilepath,
      success: successful
    })
  }
}
module.exports = Gallery