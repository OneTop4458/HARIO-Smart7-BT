const photos = new Map([
  ['v60', {
    file: './reference-v60.jpg',
    author: 'GorillaWarfare',
    source: 'https://commons.wikimedia.org/wiki/File:Coffee_pour_over_using_Hario_cone.jpg',
    license: 'CC BY-SA 1.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/1.0/'
  }],
  ['cup', {
    file: './reference-cup.jpg',
    author: 'Martin Falbisoner',
    source: 'https://commons.wikimedia.org/wiki/File:Cup_and_coffee_beans.JPG',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/'
  }],
  ['iced', {
    file: './reference-iced.jpg',
    author: 'roland',
    source: 'https://commons.wikimedia.org/wiki/File:Iced_cold_brew_coffee.jpg',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
  }]
]);

export function recipePhoto(key) {
  return photos.get(key) ?? photos.get('v60');
}
